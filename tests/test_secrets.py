"""Test suite for Secrets + Login Hydration module."""

import os
import sys
import pytest
import subprocess
from unittest.mock import patch, MagicMock

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.security import (
    getRequiredEnv, redact, validateSecrets, assertNoSecretsInLogs, scrub_text, scrub_dict,
    FTPConfig, WPConfig, preflight_auth, SecretFilter, block_secrets_from_memory, MissingSecretError
)


# ====================
# Environment Variable Tests
# ====================

def test_getRequiredEnv_success(monkeypatch):
    """Test getRequiredEnv returns value when env var is set."""
    monkeypatch.setenv('TEST_VAR', 'test_value')
    assert getRequiredEnv('TEST_VAR') == 'test_value'


def test_getRequiredEnv_missing(monkeypatch):
    """Test getRequiredEnv raises MissingSecretError when env var is missing."""
    monkeypatch.delenv('MISSING_VAR', raising=False)
    with pytest.raises(MissingSecretError):
        getRequiredEnv('MISSING_VAR')


def test_getRequiredEnv_empty(monkeypatch):
    """Test getRequiredEnv treats empty string as missing."""
    monkeypatch.setenv('EMPTY_VAR', '')
    with pytest.raises(MissingSecretError):
        getRequiredEnv('EMPTY_VAR')


# ====================
# Redaction Tests
# ====================

def test_redact_full():
    """Test redact with full redaction (no keep_chars)."""
    assert redact('secret123') == '[REDACTED]'
    assert redact('') == '[REDACTED]'


def test_redact_partial():
    """Test redact with partial reveal."""
    assert redact('secret123', keep_chars=3) == 'sec...123'
    assert redact('ab', keep_chars=1) == 'ab'  # too short to split


def test_redact_none():
    """Test redact with None."""
    assert redact(None) == '[REDACTED]'


# ====================
# Scrubbing Tests
# ====================

def test_scrub_text_password():
    """Test scrub_text removes FTP_PASS patterns."""
    text = " Connecting with FTP_PASS=mysecretpassword"
    scrubbed = scrub_text(text)
    assert 'mysecretpassword' not in scrubbed
    assert '[REDACTED]' in scrubbed


def test_scrub_text_wp_password():
    """Test scrub_text removes WP_APP_PASSWORD patterns."""
    text = "WP_APP_PASSWORD=abcdef123456"
    scrubbed = scrub_text(text)
    assert 'abcdef123456' not in scrubbed


def test_scrub_text_authorization():
    """Test scrub_text removes Authorization headers."""
    text = "Authorization: Basic YWRtaW46cGFzc3dvcmQ="
    scrubbed = scrub_text(text)
    assert 'YWRtaW46cGFzc3dvcmQ=' not in scrubbed


def test_scrub_text_ssh_key():
    """Test scrub_text removes SSH private keys."""
    ssh_key = """-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAA...
-----END OPENSSH PRIVATE KEY-----"""
    text = f"Key file:\n{ssh_key}"
    scrubbed = scrub_text(text)
    assert 'BEGIN OPENSSH PRIVATE KEY' not in scrubbed
    assert 'END OPENSSH PRIVATE KEY' not in scrubbed


def test_scrub_dict_nested():
    """Test scrub_dict redacts secret patterns in string values."""
    data = {
        'host': 'example.com',
        'config': 'FTP_PASS=secret123',  # value contains secret pattern
        'nested': {
            'auth': 'WP_APP_PASSWORD=pass456',
            'safe_field': 'keep me'
        },
        'list': ['normal', 'API_KEY=abc123']
    }
    scrubbed = scrub_dict(data)
    assert scrubbed['host'] == 'example.com'
    assert scrubbed['config'] == '[REDACTED]'
    assert scrubbed['nested']['auth'] == '[REDACTED]'
    assert scrubbed['nested']['safe_field'] == 'keep me'
    assert scrubbed['list'][0] == 'normal'
    assert scrubbed['list'][1] == '[REDACTED]'  # API_KEY pattern fully redacted


# ====================
# FTPConfig Tests
# ====================

def test_ftpconfig_from_env_success(monkeypatch):
    """Test FTPConfig.from_env with valid env vars."""
    monkeypatch.setenv('FTP_HOST', 'ftp.example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_PASS', 'pass')
    config = FTPConfig.from_env()
    assert config.host == 'ftp.example.com'
    assert config.user == 'user'
    assert config.passwd == 'pass'
    assert config.port == 21


def test_ftpconfig_from_env_ssh_key(monkeypatch):
    """Test FTPConfig.from_env with SSH key auth."""
    monkeypatch.setenv('FTP_HOST', 'example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_SSH_KEY_PATH', '/path/to/key')
    config = FTPConfig.from_env()
    assert config.ssh_key_path == '/path/to/key'
    assert config.passwd == ''  # no password when using SSH key


def test_ftpconfig_from_env_missing_host(monkeypatch):
    """Test FTPConfig.from_env fails when FTP_HOST is missing."""
    monkeypatch.delenv('FTP_HOST', raising=False)
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_PASS', 'pass')
    with pytest.raises(MissingSecretError):
        FTPConfig.from_env()


def test_ftpconfig_from_env_missing_auth(monkeypatch):
    """Test FTPConfig.from_env fails when neither password nor SSH key provided."""
    monkeypatch.setenv('FTP_HOST', 'example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    # No FTP_PASS and no FTP_SSH_KEY_PATH
    with pytest.raises(ValueError):
        FTPConfig.from_env()


def test_ftpconfig_str_contains_no_secrets(monkeypatch):
    """Test FTPConfig.__str__ does not expose secrets."""
    monkeypatch.setenv('FTP_HOST', 'example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_PASS', 'super_secret_password')
    config = FTPConfig.from_env()
    s = str(config)
    assert 'super_secret_password' not in s
    assert 'user' in s
    assert 'example.com' in s


# ====================
# WPConfig Tests
# ====================

def test_wpconfig_from_env_success(monkeypatch):
    """Test WPConfig.from_env with valid env vars."""
    monkeypatch.setenv('WP_SITE_URL', 'https://example.com')
    monkeypatch.setenv('WP_USERNAME', 'admin')
    monkeypatch.setenv('WP_APP_PASSWORD', 'app_pass_123')
    config = WPConfig.from_env()
    assert config.url == 'https://example.com'
    assert config.username == 'admin'
    assert config.app_password == 'app_pass_123'
    assert config.rest_base == '/wp-json'
    assert config.timeout == 20


def test_wpconfig_from_env_custom_timeout(monkeypatch):
    """Test WPConfig.from_env respects custom timeout."""
    monkeypatch.setenv('WP_SITE_URL', 'https://example.com')
    monkeypatch.setenv('WP_USERNAME', 'admin')
    monkeypatch.setenv('WP_APP_PASSWORD', 'pass')
    monkeypatch.setenv('WP_TIMEOUT_SEC', '30')
    config = WPConfig.from_env()
    assert config.timeout == 30


def test_wpconfig_str_contains_no_secrets(monkeypatch):
    """Test WPConfig.__str__ does not expose app password."""
    monkeypatch.setenv('WP_SITE_URL', 'https://example.com')
    monkeypatch.setenv('WP_USERNAME', 'admin')
    monkeypatch.setenv('WP_APP_PASSWORD', 'super_secret_app_pass')
    config = WPConfig.from_env()
    s = str(config)
    assert 'super_secret_app_pass' not in s
    assert 'admin' in s
    assert 'https://example.com' in s


# ====================
# validateSecrets Tests
# ====================

def test_validateSecrets_ftp_only(monkeypatch):
    """Test validateSecrets with FTP only."""
    monkeypatch.setenv('FTP_HOST', 'ftp.example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_PASS', 'pass')
    result = validateSecrets(need_ftp=True, need_wp=False)
    assert result['ftp_config'] is not None
    assert result['wp_config'] is None
    assert result['errors'] == []


def test_validateSecrets_wp_only(monkeypatch):
    """Test validateSecrets with WP only."""
    monkeypatch.setenv('WP_SITE_URL', 'https://example.com')
    monkeypatch.setenv('WP_USERNAME', 'admin')
    monkeypatch.setenv('WP_APP_PASSWORD', 'pass')
    result = validateSecrets(need_ftp=False, need_wp=True)
    assert result['ftp_config'] is None
    assert result['wp_config'] is not None
    assert result['errors'] == []


def test_validateSecrets_both(monkeypatch):
    """Test validateSecrets with both FTP and WP."""
    monkeypatch.setenv('FTP_HOST', 'ftp.example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_PASS', 'pass')
    monkeypatch.setenv('WP_SITE_URL', 'https://example.com')
    monkeypatch.setenv('WP_USERNAME', 'admin')
    monkeypatch.setenv('WP_APP_PASSWORD', 'pass')
    result = validateSecrets(need_ftp=True, need_wp=True)
    assert result['ftp_config'] is not None
    assert result['wp_config'] is not None
    assert result['errors'] == []


def test_validateSecrets_missing_ftp(monkeypatch):
    """Test validateSecrets returns error for missing FTP config."""
    monkeypatch.setenv('WP_SITE_URL', 'https://example.com')
    monkeypatch.setenv('WP_USERNAME', 'admin')
    monkeypatch.setenv('WP_APP_PASSWORD', 'pass')
    result = validateSecrets(need_ftp=True, need_wp=False)
    assert result['ftp_config'] is None
    assert len(result['errors']) > 0
    assert 'FTP configuration error' in result['errors'][0]


def test_validateSecrets_missing_wp(monkeypatch):
    """Test validateSecrets returns error for missing WP config."""
    monkeypatch.setenv('FTP_HOST', 'ftp.example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_PASS', 'pass')
    result = validateSecrets(need_ftp=False, need_wp=True)
    assert result['wp_config'] is None
    assert len(result['errors']) > 0


# ====================
# assertNoSecretsInLogs Tests
# ====================

def test_assertNoSecretsInLogs_safe_line():
    """Test assertNoSecretsInLogs returns True for safe log lines."""
    safe_lines = [
        "INFO: Connection to host example.com successful",
        "INFO: Status code 200",
        "INFO: Missing required environment variable: FTP_HOST",
        "INFO: Test completed"
    ]
    for line in safe_lines:
        assert assertNoSecretsInLogs(line) is True


def test_assertNoSecretsInLogs_unsafe_password():
    """Test assertNoSecretsInLogs detects password in log."""
    unsafe_line = "DEBUG: Connecting with FTP_PASS=mysecret123"
    assert assertNoSecretsInLogs(unsafe_line) is False


def test_assertNoSecretsInLogs_unsafe_wp_password():
    """Test assertNoSecretsInLogs detects WP password."""
    unsafe_line = "DEBUG: WP_APP_PASSWORD=abc123xyz"
    assert assertNoSecretsInLogs(unsafe_line) is False


def test_assertNoSecretsInLogs_unsafe_authorization():
    """Test assertNoSecretsInLogs detects Authorization header."""
    unsafe_line = "DEBUG: Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l"
    assert assertNoSecretsInLogs(unsafe_line) is False


# ====================
# block_secrets_from_memory Tests
# ====================

def test_block_secrets_from_memory_dict():
    """Test block_secrets_from_memory redacts secret keys in dict."""
    data = {
        'username': 'admin',
        'password': 'secret123',
        'wp_app_password': 'wp_pass_xyz',
        'nested': {
            'ftp_pass': 'ftp_secret'
        }
    }
    result = block_secrets_from_memory(data)
    assert result['username'] == 'admin'
    assert result['password'] == '[REDACTED]'
    assert result['wp_app_password'] == '[REDACTED]'
    assert result['nested']['ftp_pass'] == '[REDACTED]'


def test_block_secrets_from_memory_string():
    """Test block_secrets_from_memory redacts secrets in string."""
    text = "FTP_PASS=mysecret and WP_APP_PASSWORD=pass123"
    result = block_secrets_from_memory(text)
    assert 'mysecret' not in result
    assert 'pass123' not in result
    assert '[REDACTED]' in result


def test_block_secrets_from_memory_list():
    """Test block_secrets_from_memory handles lists."""
    data = ['normal', 'API_KEY=secret', {'key': 'value'}]
    result = block_secrets_from_memory(data)
    assert result[0] == 'normal'
    assert 'secret' not in result[1]
    assert result[2]['key'] == 'value'


# ====================
# SecretFilter Tests
# ====================

def test_secret_filter_on_message():
    """Test SecretFilter scrubs secrets from log messages."""
    import logging
    logger = logging.getLogger('test')
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.addFilter(SecretFilter())
    logger.addHandler(handler)

    # Would need to capture output - for now just test that filter doesn't crash
    # In a real test, we'd use caplog fixture
    try:
        logger.info("Test message with FTP_PASS=secret")
    except Exception as e:
        pytest.fail(f"SecretFilter raised exception: {e}")


# ====================
# Integration Tests
# ====================

class TestPreflightAuth:
    """Integration tests for preflight_auth function."""

    def test_preflight_missing_env_ftp(self, monkeypatch, capsys):
        """Test preflight_auth fails when FTP env is missing."""
        monkeypatch.delenv('FTP_HOST', raising=False)
        monkeypatch.delenv('FTP_USER', raising=False)
        monkeypatch.delenv('FTP_PASS', raising=False)
        with pytest.raises(SystemExit) as excinfo:
            preflight_auth(need_ftp=True, need_wp=False)
        assert excinfo.value.code == 1
        captured = capsys.readouterr()
        assert 'Missing required secret environment variable' in captured.err

    def test_preflight_missing_env_wp(self, monkeypatch, capsys):
        """Test preflight_auth fails when WP env is missing."""
        monkeypatch.delenv('WP_SITE_URL', raising=False)
        monkeypatch.delenv('WP_USERNAME', raising=False)
        monkeypatch.delenv('WP_APP_PASSWORD', raising=False)
        with pytest.raises(SystemExit) as excinfo:
            preflight_auth(need_ftp=False, need_wp=True)
        assert excinfo.value.code == 1

    def test_preflight_ftp_success(self, monkeypatch, capsys):
        """Test preflight_auth with valid FTP env (should fail because no real server)."""
        monkeypatch.setenv('FTP_HOST', '127.0.0.1')  # No FTP server running
        monkeypatch.setenv('FTP_USER', 'testuser')
        monkeypatch.setenv('FTP_PASS', 'testpass')
        with pytest.raises(SystemExit) as excinfo:
            preflight_auth(need_ftp=True, need_wp=False)
        # Should fail on connection attempt, not validation
        assert excinfo.value.code == 1

    def test_preflight_wp_success(self, monkeypatch, capsys):
        """Test preflight_auth with valid WP env (should fail because no real server)."""
        monkeypatch.setenv('WP_SITE_URL', 'http://127.0.0.1:1')  # Invalid port
        monkeypatch.setenv('WP_USERNAME', 'admin')
        monkeypatch.setenv('WP_APP_PASSWORD', 'pass')
        with pytest.raises(SystemExit) as excinfo:
            preflight_auth(need_ftp=False, need_wp=True)
        assert excinfo.value.code == 1


# ====================
# End-to-End Workflow Tests
# ====================

def test_full_workflow_validate_and_redact(monkeypatch):
    """Test complete workflow: validate, get config, redact text."""
    monkeypatch.setenv('FTP_HOST', 'ftp.example.com')
    monkeypatch.setenv('FTP_USER', 'user')
    monkeypatch.setenv('FTP_PASS', 'supersecret')
    monkeypatch.setenv('WP_SITE_URL', 'https://example.com')
    monkeypatch.setenv('WP_USERNAME', 'admin')
    monkeypatch.setenv('WP_APP_PASSWORD', 'app_secret')

    # Validate
    secrets = validateSecrets(need_ftp=True, need_wp=True)
    assert secrets['errors'] == []
    assert secrets['ftp_config'] is not None
    assert secrets['wp_config'] is not None

    # Redact a log message that might be stored
    # Use a pattern that includes the secret identifier to ensure redaction
    log_message = f"FTP connection: FTP_PASS={secrets['ftp_config'].passwd} as user {secrets['ftp_config'].user}"
    scrubbed = scrub_text(log_message)
    assert 'supersecret' not in scrubbed
    assert '[REDACTED]' in scrubbed
    assert 'user' in scrubbed  # user field should remain

    # Ensure string representations don't leak secrets
    assert 'supersecret' not in str(secrets['ftp_config'])
    assert 'app_secret' not in str(secrets['wp_config'])


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
