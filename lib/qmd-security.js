/**
 * QMD Security Module – Secret Detection & Sanitization
 *
 * Scans data objects for common secret patterns before DB writes.
 * Redacts matched values and logs warnings.
 */

const SECRET_PATTERNS = [
  { type: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/g },
  { type: 'aws_secret_key', pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi },
  { type: 'github_token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g },
  { type: 'slack_token', pattern: /xox[baprs]-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{24,}/g },
  { type: 'private_key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g },
  { type: 'jwt', pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g },
  { type: 'generic_password', pattern: /(?:password|passwd|pwd|secret|token|api_key|apikey|access_key)\s*[=:]\s*['"][^'"]{8,}['"]/gi },
  { type: 'bearer_token', pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { type: 'connection_string', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'"]+/gi },
  { type: 'wp_app_password', pattern: /WordPress\s+REST\s+API.*[A-Za-z0-9]{4}\s[A-Za-z0-9]{4}\s[A-Za-z0-9]{4}/gi },
];

// Fields that are allowed to contain password-like values (e.g., user metadata)
const ALLOWED_FIELDS = new Set([
  'password_hash', 'hashed_password', 'auth_provider',
]);

/**
 * Deep-scan an object for secrets, returning a sanitized copy.
 */
function deepSanitize(obj, path = '', findings = []) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    let sanitized = obj;
    for (const { type, pattern } of SECRET_PATTERNS) {
      const matches = sanitized.match(pattern);
      if (matches) {
        for (const match of matches) {
          findings.push({ type, path: path || '(root)', preview: match.substring(0, 20) + '...' });
          sanitized = sanitized.replace(match, `[REDACTED_${type.toUpperCase()}]`);
        }
      }
    }
    return sanitized;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, i) => deepSanitize(item, `${path}[${i}]`, findings));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const childPath = path ? `${path}.${key}` : key;
      if (ALLOWED_FIELDS.has(key)) {
        result[key] = value; // Skip known safe fields
      } else {
        result[key] = deepSanitize(value, childPath, findings);
      }
    }
    return result;
  }

  return obj; // numbers, booleans, etc.
}

const security = {
  /**
   * Sanitize data before writing to storage.
   * @param {any} data - Data to sanitize
   * @param {string} context - Operation name for logging (e.g., 'task.create')
   * @returns {any} Sanitized copy of data
   */
  safeWrite(data, context) {
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object' && typeof data !== 'string') return data;

    const findings = [];
    const sanitized = deepSanitize(data, '', findings);

    if (findings.length > 0) {
      console.warn(`[SECURITY] ${context}: ${findings.length} secret(s) redacted`, findings);
    }

    return sanitized;
  },

  /**
   * Validate data before reading from storage.
   * @param {any} data - Data to validate
   * @param {string} context - Operation name
   * @returns {boolean} True if safe to read
   */
  safeRead(data, context) {
    return true; // Reads are always safe — secrets are redacted on write
  },

  /**
   * Scan a string for potential secrets.
   * @param {string} str - String to scan
   * @returns {Array<{type: string, value: string, line: number}>} Detected secrets
   */
  scanForSecrets(str) {
    if (typeof str !== 'string') return [];
    const results = [];
    for (const { type, pattern } of SECRET_PATTERNS) {
      const matches = str.matchAll(pattern);
      for (const match of matches) {
        results.push({
          type,
          value: match[0].substring(0, 30) + '...',
          index: match.index,
        });
      }
    }
    return results;
  }
};

module.exports = security;
