"""Pytest configuration and fixtures for secrets module tests."""

import os
import pytest


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Ensure each test has a clean environment."""
    # Save relevant env vars
    saved = {}
    for key in ['FTP_HOST', 'FTP_PORT', 'FTP_USER', 'FTP_PASS', 'FTP_SSH_KEY_PATH',
                'FTP_SSH_KEY_PASSPHRASE', 'FTP_BASE_DIR',
                'WP_SITE_URL', 'WP_USERNAME', 'WP_APP_PASSWORD', 'WP_REST_BASE', 'WP_TIMEOUT_SEC']:
        if key in os.environ:
            saved[key] = os.environ[key]
            monkeypatch.delenv(key, raising=False)

    # Ensure clean slate
    yield

    # Restore after test (not strictly needed but for clarity)
    pass
