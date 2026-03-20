#!/usr/bin/env python3
"""
Secrets + Login Hydration Module

This module provides secure handling of credentials for FTP and WordPress operations.
It ensures:
- Secrets are never stored in memory (QMD/builtin)
- Fail-fast auth validation before operations
- Redaction in logs
- Safe environment variable loading
"""

import os
import sys
import re
import json
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from pathlib import Path

# ====================
# Exceptions
# ====================

class MissingSecretError(Exception):
    """Raised when a required environment variable is missing."""
    pass

class SecretValidationError(Exception):
    """Raised when secret validation fails (e.g., invalid credentials)."""
    pass

# ====================
# Configuration
# ====================

# Define which env vars belong to which service
FTP_ENV_VARS = [
    "FTP_HOST",
    "FTP_PORT",
    "FTP_USER",
    "FTP_PASS",
    "FTP_SSH_KEY_PATH",
    "FTP_SSH_KEY_PASSPHRASE",
    "FTP_BASE_DIR"
]

WP_ENV_VARS = [
    "WP_SITE_URL",
    "WP_USERNAME",
    "WP_APP_PASSWORD",
    "WP_REST_BASE",
    "WP_TIMEOUT_SEC"
]

# All secret patterns to redact from logs/memory
SECRET_PATTERNS = [
    # FTP/SSH
    re.compile(r'FTP_PASS=.+?(&|\s|$)', re.IGNORECASE),
    re.compile(r'FTP_SSH_KEY_PASSPHRASE=.+?(&|\s|$)', re.IGNORECASE),
    re.compile(r'Authorization:\s+Basic\s+.+', re.IGNORECASE),
    re.compile(r'-----BEGIN OPENSSH PRIVATE KEY-----.*?-----END OPENSSH PRIVATE KEY-----', re.DOTALL),
    re.compile(r'-----BEGIN RSA PRIVATE KEY-----.*?-----END RSA PRIVATE KEY-----', re.DOTALL),
    # WordPress
    re.compile(r'WP_APP_PASSWORD=.+?(&|\s|$)', re.IGNORECASE),
    # Generic API keys
    re.compile(r'API[_-]?KEY=.+?(&|\s|$)', re.IGNORECASE),
    re.compile(r'Bearer\s+[A-Za-z0-9\-_]+', re.IGNORECASE),
]

# Safe log messages that can contain partial info
SAFE_LOG_KEYS = [
    "host", "url", "endpoint", "status", "code", "missing", "required", "env var", "failed"
]

# ====================
# Data Classes
# ====================

@dataclass
class FTPConfig:
    host: str
    port: int
    user: str
    passwd: str
    ssh_key_path: Optional[str] = None
    ssh_key_passphrase: Optional[str] = None
    base_dir: Optional[str] = None

    @classmethod
    def from_env(cls) -> 'FTPConfig':
        """Build FTP config from environment variables."""
        host = getRequiredEnv('FTP_HOST')
        port = int(os.getenv('FTP_PORT', '21' if 'FTP_SSH_KEY_PATH' not in os.environ else '22'))
        user = getRequiredEnv('FTP_USER')
        passwd = os.getenv('FTP_PASS', '')
        ssh_key_path = os.getenv('FTP_SSH_KEY_PATH')
        ssh_key_passphrase = os.getenv('FTP_SSH_KEY_PASSPHRASE')
        base_dir = os.getenv('FTP_BASE_DIR')

        # Validate: either password or SSH key must be provided
        if not passwd and not ssh_key_path:
            raise ValueError(
                "FTP authentication requires either FTP_PASS (password) or "
                "FTP_SSH_KEY_PATH (SSH private key)."
            )

        return cls(
            host=host,
            port=port,
            user=user,
            passwd=passwd,
            ssh_key_path=ssh_key_path,
            ssh_key_passphrase=ssh_key_passphrase,
            base_dir=base_dir
        )

    def __str__(self) -> str:
        """Safe representation without secrets."""
        return f"FTPConfig(host={self.host}, port={self.port}, user={self.user}, base_dir={self.base_dir})"


@dataclass
class WPConfig:
    url: str
    username: str
    app_password: str
    rest_base: str
    timeout: int

    @classmethod
    def from_env(cls) -> 'WPConfig':
        """Build WordPress config from environment variables."""
        url = getRequiredEnv('WP_SITE_URL')
        username = getRequiredEnv('WP_USERNAME')
        app_password = getRequiredEnv('WP_APP_PASSWORD')
        rest_base = os.getenv('WP_REST_BASE', '/wp-json')
        timeout = int(os.getenv('WP_TIMEOUT_SEC', '20'))

        return cls(
            url=url.rstrip('/'),
            username=username,
            app_password=app_password,
            rest_base=rest_base,
            timeout=timeout
        )

    def __str__(self) -> str:
        """Safe representation without secrets."""
        return f"WPConfig(url={self.url}, username={self.username}, rest_base={self.rest_base})"


# ====================
# Core Functions
# ====================

def getRequiredEnv(name: str) -> str:
    """
    Get a required environment variable.
    Raises MissingSecretError if missing.
    Never logs the value.
    """
    value = os.environ.get(name, '')
    if not value:
        raise MissingSecretError(f"Missing required secret environment variable: {name}")
    return value


def redact(value: str, keep_chars: int = 0) -> str:
    """
    Redact a sensitive string for safe logging.
    If keep_chars > 0, shows that many characters at start and end.
    If the string is too short to meaningfully redact (len <= keep_chars*2),
    returns the original value when keep_chars > 0.
    """
    if not value:
        return "[REDACTED]"
    if keep_chars > 0:
        if len(value) > keep_chars * 2:
            return f"{value[:keep_chars]}...{value[-keep_chars:]}"
        else:
            # Too short to mask meaningfully, show full (but note: may still contain secret)
            return value
    return "[REDACTED]"


def validateSecrets(need_ftp: bool = False, need_wp: bool = False) -> Dict[str, Any]:
    """
    Validate all required secrets based on what the task needs.
    Returns a dict with validated configs (FTPConfig, WPConfig) and status.

    This is the main entry point before any operation.
    """
    result = {
        "ftp_config": None,
        "wp_config": None,
        "errors": []
    }

    try:
        if need_ftp:
            result["ftp_config"] = FTPConfig.from_env()
    except Exception as e:
        result["errors"].append(f"FTP configuration error: {str(e)}")

    try:
        if need_wp:
            result["wp_config"] = WPConfig.from_env()
    except Exception as e:
        result["errors"].append(f"WordPress configuration error: {str(e)}")

    return result


def assertNoSecretsInLogs(log_line: str) -> bool:
    """
    Check if a log line contains any secret pattern.
    Returns True if safe, False if secrets detected.
    """
    # Skip if line is clearly safe (only contains safe keywords)
    if any(key in log_line.lower() for key in SAFE_LOG_KEYS):
        return True

    # Check against secret patterns
    for pattern in SECRET_PATTERNS:
        if pattern.search(log_line):
            logging.warning(
                f"Potential secret detected in log output: pattern={pattern.pattern[:50]}... "
                f"Line: {redact(log_line, keep_chars=50)}"
            )
            return False
    return True


def scrub_text(text: str, replacement: str = "[REDACTED]") -> str:
    """
    Scrub all secret patterns from a text string.
    Use before storing text in QMD/builtin or before logging.
    """
    scrubbed = text
    for pattern in SECRET_PATTERNS:
        scrubbed = pattern.sub(replacement, scrubbed)
    return scrubbed


def scrub_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively scrub secrets from a dictionary."""
    if isinstance(data, dict):
        return {k: scrub_dict(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [scrub_dict(item) for item in data]
    elif isinstance(data, str):
        return scrub_text(data)
    else:
        return data


# ====================
# Preflight Auth
# ====================

def preflight_auth(need_ftp: bool = False, need_wp: bool = False) -> None:
    """
    Preflight authentication check.
    Runs before any task that uses FTP or WordPress.
    Fails fast with clear error messages if auth is not available.
    """
    import subprocess
    import time

    print("🔐 Running preflight authentication checks...")

    # Validate secrets are present
    secrets = validateSecrets(need_ftp, need_wp)
    if secrets["errors"]:
        print("❌ Preflight failed: Missing or invalid credentials", file=sys.stderr)
        for err in secrets["errors"]:
            print(f"   - {err}", file=sys.stderr)
        print("\nPlease set the required environment variables.", file=sys.stderr)
        raise SystemExit(1)

    # FTP connectivity test
    if need_ftp and secrets["ftp_config"]:
        ftp_cfg = secrets["ftp_config"]
        print(f"🔗 Testing FTP connection to {ftp_cfg.host}:{ftp_cfg.port}...")
        try:
            # Use curl for FTPS/FTP
            cmd = [
                "curl", "-s", "--connect-timeout", "10",
                "-u", f"{ftp_cfg.user}:{ftp_cfg.passwd}" if ftp_cfg.passwd else "-u", ftp_cfg.user,
                f"ftp://{ftp_cfg.host}/"
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if result.returncode == 0:
                print("✅ FTP preflight OK")
            else:
                print(f"❌ FTP connection failed: {result.stderr[:200]}", file=sys.stderr)
                raise SystemExit(1)
        except subprocess.TimeoutExpired:
            print("❌ FTP connection timeout", file=sys.stderr)
            raise SystemExit(1)
        except Exception as e:
            print(f"❌ FTP test error: {str(e)}", file=sys.stderr)
            raise SystemExit(1)

    # WordPress REST auth test
    if need_wp and secrets["wp_config"]:
        wp_cfg = secrets["wp_config"]
        print(f"🔗 Testing WordPress REST API at {wp_cfg.url}...")

        # Test REST available
        rest_url = f"{wp_cfg.url}{wp_cfg.rest_base}"
        try:
            result = subprocess.run(
                ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", rest_url],
                capture_output=True, text=True, timeout=wp_cfg.timeout
            )
            if result.stdout.strip() != "200":
                print(f"❌ REST API not available (HTTP {result.stdout.strip()})", file=sys.stderr)
                raise SystemExit(1)
        except Exception as e:
            print(f"❌ REST test error: {str(e)}", file=sys.stderr)
            raise SystemExit(1)

        # Test auth via /users/me
        auth_url = f"{wp_cfg.url}/wp-json/wp/v2/users/me"
        try:
            result = subprocess.run(
                ["curl", "-s", "-u", f"{wp_cfg.username}:{wp_cfg.app_password}",
                 "-o", "/dev/null", "-w", "%{http_code}", auth_url],
                capture_output=True, text=True, timeout=wp_cfg.timeout
            )
            if result.stdout.strip() == "200":
                print("✅ WordPress auth OK")
            else:
                print(f"❌ WordPress auth failed (HTTP {result.stdout.strip()})", file=sys.stderr)
                print("   Check username and application password.", file=sys.stderr)
                raise SystemExit(1)
        except subprocess.TimeoutExpired:
            print("❌ WordPress auth timeout", file=sys.stderr)
            raise SystemExit(1)
        except Exception as e:
            print(f"❌ WordPress auth test error: {str(e)}", file=sys.stderr)
            raise SystemExit(1)

    print("✅ All preflight checks passed")


# ====================
# Safe Logging
# ====================

class SecretFilter(logging.Filter):
    """Logging filter that redacts secrets from log messages."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Scrub the message
        record.msg = scrub_text(str(record.msg))
        # Also scrub any arguments
        if record.args:
            record.args = tuple(
                scrub_text(str(arg)) if isinstance(arg, str) else arg
                for arg in record.args
            )
        return True


def setup_safe_logging() -> None:
    """Configure logging with secret redaction."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    # Add secret filter to root logger
    for handler in logging.root.handlers:
        handler.addFilter(SecretFilter())


# ====================
# Memory Guard (stub)
# ====================

def block_secrets_from_memory(data: Any, scrub_patterns: bool = True) -> Any:
    """
    Prevent secrets from being stored in QMD/builtin memory.
    Recursively scrubs sensitive fields from dictionaries, lists, and strings.
    
    Args:
        data: The data to sanitize (dict, list, str, or other)
        scrub_patterns: If True, also run secret pattern redaction on strings
    
    Returns:
        Sanitized copy of the data with secrets replaced by "[REDACTED]"
    """
    if isinstance(data, dict):
        # Remove any keys that look like secrets OR contain secret values
        safe_data = {}
        for k, v in data.items():
            key_lower = str(k).lower()
            # Keys that are definitely secrets:
            # - Contains substrings like 'pass', 'password', 'secret', 'token', 'credential', 'private'
            # - Ends with '_key' (e.g., api_key, private_key)
            if (any(substr in key_lower for substr in ['pass', 'password', 'secret', 'token', 'credential', 'private']) or
                key_lower.endswith('_key')):
                safe_data[k] = "[REDACTED]"
            else:
                safe_data[k] = block_secrets_from_memory(v, scrub_patterns)
        return safe_data
    elif isinstance(data, list):
        return [block_secrets_from_memory(item, scrub_patterns) for item in data]
    elif isinstance(data, str):
        if scrub_patterns:
            return scrub_text(data)
        return data
    else:
        return data


# ====================
# Main Entry Point for Testing
# ====================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Secrets + Login Hydration Module")
    parser.add_argument("--test-ftp", action="store_true", help="Test FTP connectivity")
    parser.add_argument("--test-wp", action="store_true", help="Test WordPress auth")
    parser.add_argument("--validate", action="store_true", help="Validate secrets config")
    parser.add_argument("--redact-test", type=str, help="Test redaction on a string")

    args = parser.parse_args()

    if args.validate:
        print("Validating environment...")
        try:
            secrets = validateSecrets(need_ftp=args.test_ftp, need_wp=args.test_wp)
            if secrets["errors"]:
                print("VALIDATION FAILED")
                for err in secrets["errors"]:
                    print(f"  {err}")
                sys.exit(1)
            else:
                print("✅ Secrets configuration valid")
                if secrets["ftp_config"]:
                    print(f"   FTP: {secrets['ftp_config']}")
                if secrets["wp_config"]:
                    print(f"   WP: {secrets['wp_config']}")
        except SystemExit:
            raise
        except Exception as e:
            print(f"❌ Validation error: {e}")
            sys.exit(1)

    if args.test_ftp:
        preflight_auth(need_ftp=True, need_wp=False)

    if args.test_wp:
        preflight_auth(need_ftp=False, need_wp=True)

    if args.redact_test:
        print("Original:", args.redact_test)
        print("Redacted:", scrub_text(args.redact_test))

    # If no args, show usage
    if not any([args.validate, args.test_ftp, args.test_wp, args.redact_test]):
        parser.print_help()
