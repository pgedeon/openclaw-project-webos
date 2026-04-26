/**
 * Task Repository — proxy module for task CRUD operations.
 *
 * Currently re-exports directly from asana.js (proxy pattern).
 * Methods will be migrated incrementally in future phases.
 */

// Re-export the AsanaStorage class as-is.
// In future phases, individual task methods will be moved here
// and the asana.js class will delegate to this module.
const AsanaStorage = require('./asana');

module.exports = { AsanaStorage };
