#!/usr/bin/env node
/**
 * Backward-compatible alias for the service requests API module.
 */

const { serviceRequestsAPI } = require('./service-requests-api.js');

module.exports = {
  servicesAPI: serviceRequestsAPI,
  serviceRequestsAPI
};
