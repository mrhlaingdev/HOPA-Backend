function createAuditLogger(pool) {
  return async function logActivity(userId, userRole, action, resource, details = null) {
    const serializedDetails = details === null || details === undefined
      ? null
      : typeof details === 'string'
        ? details
        : JSON.stringify(details);

    try {
      const [result] = await pool.query(
        `INSERT INTO audit_logs
          (user_id, user_role, action, resource, details)
         VALUES (?, ?, ?, ?, ?)`,
        [userId ?? null, userRole ?? null, action, resource, serializedDetails],
      );
      return result;
    } catch (error) {
      console.error('Failed to write audit log:', error.message);
      return null;
    }
  };
}

module.exports = { createAuditLogger };
