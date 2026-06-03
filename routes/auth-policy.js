/**
 * Token-mode auth policy.
 *
 * Full multi-operator auth is intentionally deferred until the product has a
 * real multi-operator requirement. Until then, the dashboard has exactly one
 * effective actor authenticated by DASHBOARD_AUTH_TOKEN.
 */
const crypto = require('crypto');

const DASHBOARD_ACTOR = 'dashboard-operator';
const DASHBOARD_ROLE = 'operator';
const DEFERRED_REASON = 'Full auth is deferred until a multi-operator requirement exists.';

function extractBearerToken(authHeader = '') {
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

function timingSafeTokenEqual(token, expectedToken) {
  if (!token || !expectedToken) return false;

  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  return tokenBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

function getAuthPolicy(expectedToken = process.env.DASHBOARD_AUTH_TOKEN || '') {
  const tokenRequired = Boolean(expectedToken);

  return {
    mode: tokenRequired ? 'token' : 'open',
    actor: DASHBOARD_ACTOR,
    role: DASHBOARD_ROLE,
    tokenRequired,
    supportedSchemes: tokenRequired ? ['bearer-token'] : ['open-local-dev'],
    publicRoutes: ['/api/health', '/api/auth/self'],
    capabilities: {
      bearerToken: tokenRequired,
      singleOperator: true,
      sessions: false,
      rbac: false,
      multiOperator: false,
    },
    deferred: {
      fullAuth: true,
      until: 'multi-operator requirement exists',
      reason: DEFERRED_REASON,
    },
  };
}

function getSelfAuthState(req, expectedToken = process.env.DASHBOARD_AUTH_TOKEN || '') {
  const policy = getAuthPolicy(expectedToken);
  const token = extractBearerToken(req.headers?.authorization || '');
  const authenticated = policy.tokenRequired ? timingSafeTokenEqual(token, expectedToken) : true;

  return {
    authenticated,
    mode: policy.mode,
    actor: authenticated ? policy.actor : null,
    role: authenticated ? policy.role : null,
    user: authenticated ? policy.actor : null,
    tokenRequired: policy.tokenRequired,
    supportedSchemes: policy.supportedSchemes,
    publicRoutes: policy.publicRoutes,
    capabilities: policy.capabilities,
    deferred: policy.deferred,
  };
}

module.exports = {
  DASHBOARD_ACTOR,
  DASHBOARD_ROLE,
  DEFERRED_REASON,
  extractBearerToken,
  timingSafeTokenEqual,
  getAuthPolicy,
  getSelfAuthState,
};
