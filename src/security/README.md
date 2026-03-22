# Secrets + Login Hydration Module

## Overview

This module provides secure handling of credentials for FTP and WordPress operations within the 3dput OpenClaw automation system. It implements the **secrets contract** defined in `openclaw-qmd-secrets-login-hydration.md`.

**Key Principles:**
- **No secrets in memory**: Credentials are loaded from environment variables only and never written to QMD/builtin memory stores.
- **Fail-fast validation**: Preflight checks verify connectivity and auth before any destructive operation.
- **Redaction**: Automatic scrubbing of secrets from logs and stored text.
- **Safe logging**: Log only safe metadata (hostnames, status codes, error categories).

## Files

- `src/security/secrets.py` - Core Python module with all functionality
- `src/security/__init__.py` - Package exports
- `scripts/preflight-auth` - Bash wrapper for quick preflight checks
- `scripts/openclaw-gateway-with-preflight.sh` - **Gateway startup wrapper** (runs preflight then starts OpenClaw)
- `scripts/test-secrets-module.py` - Automated test suite (4 tests, all passing)
- `skills/pinch-to-post/wp-rest.sh` - Updated to call preflight automatically
- `plugins/upload-fsw.sh` - Uses env vars + preflight
- `deploy-fsw-simple.sh` - Uses env vars + preflight

## Environment Variables

### WordPress (Application Password)
```bash
WP_SITE_URL=https://3dput.com
WP_USERNAME=admin
WP_APP_PASS=V2W3 GbQC Sbgj eeX7 9klH GHLS
```

### FTP (FTPS)
```bash
FTP_HOST=cp22-ga.privatesystems.net
FTP_USER=openclaw@3dput.com
FTP_PASS=@p3nKaW!?@w38
```

Optional:
- `FTP_PORT` (default: 21 for FTP, 22 for SFTP)
- `FTP_BASE_DIR` - remote base directory
- `FTP_SSH_KEY_PATH` + `FTP_SSH_KEY_PASSPHRASE` - for SFTP key auth (preferred)

### Safety Toggles
- `OPENCLAW_FAIL_FAST=1` (default) - abort immediately on auth failure
- `OPENCLAW_LOG_LEVEL` - logging level

## Usage

### In Python Scripts
```python
from src.security import preflight_auth, FTPConfig, WPConfig, scrub_text

# Run preflight before any operation
preflight_auth(need_ftp=True, need_wp=False)

# Or load configs manually
secrets = validateSecrets(need_ftp=True, need_wp=True)
if secrets["errors"]:
    # handle errors
    pass
ftp_cfg = secrets["ftp_config"]
wp_cfg = secrets["wp_config"]
```

### In Bash Scripts
```bash
# Export required env vars
export FTP_HOST=...
export FTP_USER=...
export FTP_PASS=...

# Run preflight (exits on failure)
python3 src/security/secrets.py --test-ftp --validate

# Or use the wrapper
scripts/preflight-auth --ftp
```

### Command Line Tests
```bash
# Validate environment (both FTP and WP)
python3 src/security/secrets.py --validate --test-ftp --test-wp

# Test FTP only
python3 src/security/secrets.py --test-ftp

# Test WordPress only
python3 src/security/secrets.py --test-wp

# Test redaction
python3 src/security/secrets.py --redact-test "password=secret123"
```

## Integration Points

Updated scripts that now use the Secrets module:

1. **`skills/pinch-to-post/wp-rest.sh`**
   - `check_env()` calls preflight before any WP REST operation
   - `check_wc_env()` calls preflight before WooCommerce operations

2. **`plugins/upload-fsw.sh`**
   - Loads FTP credentials from environment (with hard-coded fallbacks for backward compatibility)
   - Runs preflight before any upload
   - Credentials are exported so Python module can read them

3. **`deploy-fsw-simple.sh`**
   - Same as above

## What's Implemented (As of 2026-02-14)

✅ Parts B and C:
- Secrets contract defined (environment variable mapping)
- Core functions implemented: `getRequiredEnv`, `redact`, `validateSecrets`, `assertNoSecretsInLogs`, `scrub_text`, `scrub_dict`
- Data classes: `FTPConfig`, `WPConfig` with `.from_env()` builders
- Secret pattern library (FTP_PASS, WP_APP_PASS, Authorization headers, private keys) with case-insensitive matching
- Safe logging filter class (`SecretFilter`)
- Memory write guard: `block_secrets_from_memory()` - recursively scrubs secrets from dicts, lists, and strings; fully implemented and tested

✅ Part D:
- Preflight auth entrypoint: `preflight_auth()`
- FTP connectivity test using curl with timeout
- WordPress REST auth test (`/users/me` endpoint)
- Clear error messages without secret leakage
- Bash wrapper script (`scripts/preflight-auth`)
- Gateway startup wrapper (`scripts/openclaw-gateway-with-preflight.sh`) for automatic preflight on boot

✅ Part E:
- Memory guard fully implemented with robust sanitization
- Handles nested structures, preserves non-secret data
- Case-insensitive secret matching (catches ftp_pass, FTP_PASS, etc.)
- Verified via automated test suite

✅ Part F:
- Preflight wired into WordPress operations (wp-rest.sh, wp-rest-woo.sh)
- Preflight wired into FTP upload scripts (upload-fsw.sh, deploy-fsw-simple.sh)
- Fail-fast behavior on auth failure

✅ Part H:
- Automated test suite created: `scripts/test-secrets-module.py`
- Tests cover: text scrubbing (7 cases), dict sanitization, nested structures, real memory file scan
- All tests passing (4/4)

❌ Optional Enhancements (Defer):
- **Full memory guard wiring into OpenClaw core**: Currently, the guard function exists and can be called manually; integration into the built-in memory write path would require modifying the OpenClaw gateway (Node.js layer). This is documented for future work.
- **Hard-coded credential removal**: Some legacy scripts still contain fallback credentials; they should be removed in favor of strict env-only usage.

## Notes

- The module is intentionally **Python-based** to be accessible by both shell scripts and OpenClaw (which can run Python).
- For production, consider moving to a compiled binary or Node.js module if performance is critical.
- The current `.env` file contains plaintext secrets. In a hardened deployment, use a secret manager (Agenix, HashiCorp Vault, or OS-level env injection).

## Example Workflow

```bash
# 1. Set environment variables (ideally in .env or systemd service)
export WP_SITE_URL=https://3dput.com
export WP_USERNAME=admin
export WP_APP_PASS=xxxx
export FTP_HOST=cp22-ga.privatesystems.net
export FTP_USER=openclaw@3dput.com
export FTP_PASS=xxxx

# 2. Run preflight manually to verify
scripts/preflight-auth --ftp --wp

# 3. Execute a WordPress operation (automatically calls preflight)
skills/pinch-to-post/wp-rest.sh create-post "Hello" "<p>World</p>" draft

# 4. Deploy a plugin (runs preflight before upload)
plugins/upload-fsw.sh
```

## Security Model

The threat model assumes:
- The system is already secured (firewall, TLS, etc.)
- The primary risk is **accidental secret leakage** via logs, memory dumps, or backups
- This module mitigates that by:
  - Validating secrets are present *before* operations
  - Ensuring curl/FTP clients don't log credentials (by not using verbose flags)
  - Providing redaction utilities for any text that might be stored
  - Giving clear error messages that don't reveal secret values

## Fail-Fast Philosophy

If credentials are missing or invalid, the system stops immediately with a message like:

```
ERROR: Missing required secret environment variable: WP_APP_PASSWORD
Please set WP_APP_PASSWORD before running this task.
```

Not:

```
[DEBUG] Attempting auth with admin:V2W3 GbQC Sbgj...
```

This prevents both UI leakage and logfile exposure.
