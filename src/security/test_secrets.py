#!/usr/bin/env python3
"""
Test suite for secrets module
Run with: python3 -m pytest test_secrets.py -v
Or: python3 test_secrets.py (manual runner)
"""

#!/usr/bin/env python3
"""
Test suite for secrets module
Run with: python3 -m pytest test_secrets.py -v
Or: python3 test_secrets.py (manual runner)
"""

import os
import sys
from unittest.mock import patch, MagicMock

# Add workspace src to path
workspace = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if workspace not in sys.path:
    sys.path.insert(0, workspace)

import src.security.secrets as secrets

# Extract functions/classes for convenience
getRequiredEnv = secrets.getRequiredEnv
redact = secrets.redact
validateSecrets = secrets.validateSecrets
scrub_text = secrets.scrub_text
scrub_dict = secrets.scrub_dict
preflight_auth = secrets.preflight_auth
FTPConfig = secrets.FTPConfig
WPConfig = secrets.WPConfig
SecretFilter = secrets.SecretFilter

# ====================
# Tests
# ====================

def test_redact_keeps_start_end():
    """redact() preserves first/last N chars when keep_chars specified."""
    secret = "mysecretpassword123"
    result = redact(secret, keep_chars=3)
    assert result == "myc...123"

def test_redact_empty():
    """redact() returns [REDACTED] for empty strings."""
    assert redact("") == "[REDACTED]"

def test_redact_none():
    """redact() returns [REDACTED] for None."""
    assert redact(None) == "[REDACTED]"

def test_scrub_text_removes_ftp_pass():
    """scrub_text() removes FTP_PASS from strings."""
    text = "Connecting with FTP_PASS=supersecret123"
    result = scrub_text(text)
    assert "supersecret123" not in result
    assert "[REDACTED]" in result

def test_scrub_text_removes_wp_app_pass():
    """scrub_text() removes WP_APP_PASSWORD."""
    text = "WP_APP_PASSWORD=abcd1234"
    result = scrub_text(text)
    assert "abcd1234" not in result

def test_scrub_text_removes_authorization_header():
    """scrub_text() removes Basic auth headers."""
    text = "Authorization: Basic dXNlcjpwYXNzd29yZA=="
    result = scrub_text(text)
    assert "dXNlcjpwYXNzd29yZA==" not in result

def test_scrub_dict_recursive():
    """scrub_dict() scrubs all strings recursively."""
    data = {
        "url": "https://example.com",
        "credentials": {
            "user": "admin",
            "password": "secret123"
        },
        "api_key": "key456"
    }
    result = scrub_dict(data)
    assert result["url"] == "https://example.com"  # not a secret pattern
    assert result["credentials"]["user"] == "admin"
    assert result["credentials"]["password"] == "[REDACTED]"
    assert result["api_key"] == "[REDACTED]"

def test_validateSecrets_no_env_returns_errors():
    """validateSecrets() returns errors when env vars missing."""
    with patch.dict(os.environ, {}, clear=True):
        result = validateSecrets(need_ftp=True, need_wp=True)
        assert "errors" in result
        assert len(result["errors"]) > 0
        assert any("FTP" in err for err in result["errors"])
        assert any("WordPress" in err for err in result["errors"])

def test_validateSecrets_ftp_success():
    """validateSecrets() returns FTPConfig when env vars set."""
    env = {
        "FTP_HOST": "example.com",
        "FTP_USER": "user",
        "FTP_PASS": "pass123"
    }
    with patch.dict(os.environ, env, clear=True):
        result = validateSecrets(need_ftp=True, need_wp=False)
        assert result["ftp_config"] is not None
        assert result["ftp_config"].host == "example.com"
        assert result["ftp_config"].user == "user"
        assert result["ftp_config"].passwd == "pass123"
        assert result["errors"] == []

def test_validateSecrets_wp_success():
    """validateSecrets() returns WPConfig when env vars set."""
    env = {
        "WP_SITE_URL": "https://example.com",
        "WP_USERNAME": "admin",
        "WP_APP_PASSWORD": "apppass123"
    }
    with patch.dict(os.environ, env, clear=True):
        result = validateSecrets(need_ftp=False, need_wp=True)
        assert result["wp_config"] is not None
        assert result["wp_config"].url == "https://example.com"
        assert result["wp_config"].username == "admin"
        assert result["wp_config"].app_password == "apppass123"

def test_validateSecrets_sftp_key_auth():
    """validateSecrets() accepts SSH key instead of password."""
    env = {
        "FTP_HOST": "example.com",
        "FTP_USER": "user",
        "FTP_SSH_KEY_PATH": "/path/to/key"
    }
    with patch.dict(os.environ, env, clear=True):
        result = validateSecrets(need_ftp=True, need_wp=False)
        assert result["ftp_config"] is not None
        assert result["ftp_config"].ssh_key_path == "/path/to/key"
        assert result["errors"] == []

def test_validateSecrets_ftp_missing_both_auth():
    """validateSecrets() errors when neither password nor SSH key provided."""
    env = {
        "FTP_HOST": "example.com",
        "FTP_USER": "user"
    }
    with patch.dict(os.environ, env, clear=True):
        result = validateSecrets(need_ftp=True, need_wp=False)
        assert len(result["errors"]) > 0
        assert "FTP authentication requires" in result["errors"][0]

def test_FTPConfig_from_env_missing_host():
    """FTPConfig.from_env() raises when FTP_HOST missing."""
    with patch.dict(os.environ, {"FTP_USER": "user"}, clear=True):
        with pytest.raises(SystemExit):
            FTPConfig.from_env()

def test_WPConfig_from_env_missing_url():
    """WPConfig.from_env() raises when WP_SITE_URL missing."""
    with patch.dict(os.environ, {"WP_USERNAME": "admin"}, clear=True):
        with pytest.raises(SystemExit):
            WPConfig.from_env()

def test_getRequiredEnv_exits_if_missing():
    """getRequiredEnv() exits with error if var not set."""
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(SystemExit):
            getRequiredEnv("MISSING_VAR")

def test_getRequiredEnv_returns_value_if_present():
    """getRequiredEnv() returns value when set."""
    with patch.dict(os.environ, {"TEST_VAR": "testvalue"}):
        assert getRequiredEnv("TEST_VAR") == "testvalue"

def test_secret_filter_scrubs_messages():
    """SecretFilter scrubs secret patterns from log messages."""
    filter_obj = SecretFilter()
    record = MagicMock()
    record.msg = "Error: FTP_PASS=supersecret"
    record.args = ()
    assert filter_obj.filter(record) is True
    assert "supersecret" not in record.msg
    assert "[REDACTED]" in record.msg

def test_scrub_text_multiple_secrets():
    """scrub_text() removes multiple different secret patterns."""
    text = "FTP_PASS=pass1 WP_APP_PASSWORD=pass2 Authorization: Basic xyz"
    result = scrub_text(text)
    assert "pass1" not in result
    assert "pass2" not in result
    assert "xyz" not in result

def test_block_secrets_from_memory_dict():
    """block_secrets_from_memory() scrubs dict recursively."""
    data = {
        "post": {
            "title": "My Post",
            "meta": {
                "_wp_password": "secret123"
            }
        }
    }
    result = block_secrets_from_memory(data)
    assert result["post"]["title"] == "My Post"
    assert result["post"]["meta"]["_wp_password"] == "[REDACTED]"

def test_block_secrets_from_memory_list():
    """block_secrets_from_memory() scrubs lists."""
    data = ["token=abc", "normal text"]
    result = block_secrets_from_memory(data)
    assert "abc" not in result[0]
    assert result[1] == "normal text"

def test_FTPConfig_str_does_not_leak():
    """FTPConfig.__str__() doesn't include password."""
    cfg = FTPConfig(host="example.com", port=21, user="user", passwd="secret123")
    s = str(cfg)
    assert "secret123" not in s
    assert "user" in s
    assert "example.com" in s

def test_WPConfig_str_does_not_leak():
    """WPConfig.__str__() doesn't include app password."""
    cfg = WPConfig(url="https://example.com", username="admin", app_password="appsecret", rest_base="/wp-json", timeout=20)
    s = str(cfg)
    assert "appsecret" not in s
    assert "admin" in s
    assert "https://example.com" in s

# ====================
# Manual test runner (without pytest)
# ====================

def run_manual_tests():
    """Run a subset of tests manually (no pytest required)."""
    print("Running manual test suite...\n")
    passed = 0
    failed = 0

    tests = [
        ("redact() preserves ends", test_redact_keeps_start_end),
        ("redact() empty string", test_redact_empty),
        ("scrub_text removes FTP_PASS", test_scrub_text_removes_ftp_pass),
        ("scrub_text removes WP_APP_PASSWORD", test_scrub_text_removes_wp_app_pass),
        ("scrub_dict recursive", test_scrub_dict_recursive),
        ("block_secrets_from_memory dict", test_block_secrets_from_memory_dict),
        ("FTPConfig __str__ safe", test_FTPConfig_str_does_not_leak),
        ("WPConfig __str__ safe", test_WPConfig_str_does_not_leak),
    ]

    for name, func in tests:
        try:
            func()
            print(f"✅ {name}")
            passed += 1
        except Exception as e:
            print(f"❌ {name}: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0

if __name__ == "__main__":
    if 'pytest' in sys.modules or 'PYTEST_CURRENT_TEST' in os.environ:
        # Running under pytest - let pytest discover tests
        pass
    else:
        # Manual execution
        success = run_manual_tests()
        sys.exit(0 if success else 1)
