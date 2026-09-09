const jwt = require('jsonwebtoken');

function getToken(req) {
  const authorization = req.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }

  return req.headers['x-auth-token']
    || req.headers['x-access-token']
    || req.headers['x-local-token']
    || null;
}

function isHeaderAuthEnabled() {
  return process.env.ALLOW_HEADER_AUTH !== 'false'
    && process.env.NODE_ENV !== 'production';
}

function authenticateToken(req, res, next) {
  const token = getToken(req);
  const headerRole = req.headers['x-user-role'] || req.headers['x-active-role'];

  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch (error) {
      if (!isHeaderAuthEnabled() || !headerRole) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired authentication token',
        });
      }
    }
  }

  if (isHeaderAuthEnabled() && headerRole) {
    req.user = {
      id: req.headers['x-user-id'] || null,
      role: String(headerRole).trim().toUpperCase(),
    };
    return next();
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication token is required',
    });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you do not have permission to perform this action',
      });
    }

    return next();
  };
}

module.exports = { authenticateToken, authorizeRoles };
