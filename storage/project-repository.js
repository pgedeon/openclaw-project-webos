/**
 * Project Repository — proxy module for project CRUD operations.
 *
 * Currently re-exports directly from asana.js (proxy pattern).
 * Methods will be migrated incrementally in future phases.
 */

const AsanaStorage = require('./asana');

module.exports = { AsanaStorage };
