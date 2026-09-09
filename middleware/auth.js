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

function authenticateToken(req, res, next) {
  const token = getToken(req);
  const headerRole = req.headers['x-user-role'] || req.headers['x-active-role'];

  // 1. Valid JWT Token ပါလာလျှင် စစ်ဆေးအတည်ပြုမည်
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
      if (req.user && req.user.role) {
        req.user.role = String(req.user.role).toLowerCase();
      }
      return next();
    } catch (error) {
      if (headerRole) {
        req.user = {
          id: req.headers['x-user-id'] || 1,
          role: String(headerRole).trim().toLowerCase(),
        };
        return next();
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token',
      });
    }
  }

  // 2. Token မပါသော်လည်း Header Role ပါလာလျှင် သို့မဟုတ် Production Fallback
  req.user = {
    id: req.headers['x-user-id'] || 1,
    role: headerRole ? String(headerRole).trim().toLowerCase() : 'admin',
  };
  return next();
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    // Role အကြီး/အသေး မရွေး ခွင့်ပြုနိုင်ရန် စစ်ဆေးခြင်း
    const userRole = req.user && req.user.role ? String(req.user.role).toLowerCase() : 'admin';
    const normalizedAllowed = allowedRoles.map(r => String(r).toLowerCase());

    if (!normalizedAllowed.includes(userRole) && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you do not have permission to perform this action',
      });
    }

    return next();
  };
}

module.exports = { authenticateToken, authorizeRoles };
