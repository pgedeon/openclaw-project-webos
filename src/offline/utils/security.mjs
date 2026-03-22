/**
 * Security utilities for XSS prevention
 */

/**
 * Escape HTML special characters to prevent XSS when using innerHTML
 * This function uses the browser's DOM parser to properly encode entities.
 * Use this when you need to insert user-generated content into innerHTML.
 * For plain text insertion, use textContent instead (preferred).
 *
 * @param {string} str - The string to escape
 * @returns {string} HTML-escaped string safe for innerHTML insertion
 */
export function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Sanitize category input - limits length and trims
 * Note: category values are used in CSS classes and textContent, not innerHTML
 *
 * @param {string} value - Category input
 * @returns {string} Sanitized category
 */
export function sanitizeCategory(value) {
  const clean = (value || '').trim();
  if (!clean) return 'General';
  return clean.slice(0, 30);
}

/**
 * Validate task priority values
 * @param {string} priority - Priority input
 * @returns {boolean} True if valid
 */
export function isValidPriority(priority) {
  return ['low', 'medium', 'high', 'critical'].includes(priority);
}

/**
 * Validate task status values
 * @param {string} status - Status input
 * @returns {boolean} True if valid
 */
export function isValidStatus(status) {
  return ['backlog', 'in_progress', 'review', 'completed', 'blocked'].includes(status);
}

/**
 * Sanitize and validate task text - returns raw text after trimming.
 * The caller should use textContent for rendering or escapeHtml for innerHTML.
 * @param {string} text - Task text input
 * @param {number} maxLength - Maximum allowed length (default 500)
 * @returns {string} Trimmed text
 */
export function sanitizeTaskText(text, maxLength = 500) {
  if (text == null) return '';
  const trimmed = text.trim();
  return trimmed.slice(0, maxLength);
}
