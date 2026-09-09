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
      return next();
    } catch (error) {
      // JWT Verify မအောင်မြင်သော်လည်း Header Role ပါလာပါက Fallback အဖြစ် လက်ခံမည်
      if (headerRole) {
        req.user = {
          id: req.headers['x-user-id'] || 1,
          role: String(headerRole).trim().toUpperCase(),
        };
        return next();
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token',
      });
    }
  }

  // 2. Token မပါသော်လည်း Header Role ပါလာလျှင် Bypass ခွင့်ပြုမည်
  if (headerRole) {
    req.user = {
      id: req.headers['x-user-id'] || 1,
      role: String(headerRole).trim().toUpperCase(),
    };
    return next();
  }

  // 3. Token ရော Header Role ပါ မပါရှိလျှင် 401 Error ပြမည်
  return res.status(401).json({
    success: false,
    message: 'Authentication token is required',
  });
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
