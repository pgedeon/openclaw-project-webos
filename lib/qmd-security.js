/**
 * QMD Security Module – Development Stub
 *
 * This is a minimal implementation to allow the dashboard to run in development.
 * In production, replace with full secrets detection/redaction logic.
 */

const security = {
  /**
   * Sanitize data before writing to storage.
   * Currently a no-op; in production, scan for secrets and redact or block.
   * @param {any} data - Data to sanitize
   * @param {string} context - Operation name for logging (e.g., 'task.create')
   * @returns {any} Sanitized copy of data
   */
  safeWrite(data, context) {
    // Development stub: return data unchanged
    // TODO: implement secret scanning and redaction for production
    return data;
  },

  /**
   * Validate data before reading from storage.
   * @param {any} data - Data to validate
   * @param {string} context - Operation name
   * @returns {boolean} True if safe to read
   */
  safeRead(data, context) {
    // Development stub: always allow
    return true;
  },

  /**
   * Scan a string for potential secrets.
   * @param {string} str - String to scan
   * @returns {Array<{type: string, value: string, line: number}>} Detected secrets
   */
  scanForSecrets(str) {
    // Development stub: no detection
    return [];
  }
};

module.exports = security;
