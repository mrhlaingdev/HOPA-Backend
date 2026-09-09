require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { authenticateToken, authorizeRoles } = require('./middleware/auth');
const { createAuditLogger } = require('./middleware/auditLogger');

const app = express();
const port = Number(process.env.PORT) || 3000;
const adminOnly = [authenticateToken, authorizeRoles('ADMIN')];

app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
  ssl: {
    rejectUnauthorized: false,
  },
});
const logActivity = createAuditLogger(pool);

async function ensureAuditLogsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(255),
      user_role VARCHAR(100),
      action VARCHAR(100) NOT NULL,
      resource VARCHAR(100) NOT NULL,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getAuthenticatedUserId(user) {
  return user?.id ?? user?.user_id ?? user?.userId ?? null;
}

const resourceDefinitions = {
  students: {
    table: 'students',
    fields: ['name', 'age', 'grade', 'parent_phone', 'address', 'status'],
    required: ['name', 'age', 'grade'],
  },
  courses: {
    table: 'courses',
    fields: ['title', 'date', 'time', 'instructor'],
    required: [],
    defaultMissingFields: true,
  },
  attendance: {
    table: 'attendance',
    fields: ['student_name', 'date', 'status', 'remarks'],
    required: ['student_name', 'date'],
  },
  finance: {
    table: 'finance',
    fields: ['title', 'amount', 'type', 'date', 'category'],
    required: ['title', 'amount', 'type', 'date'],
  },
};

function addResourceRoutes(resource, definition) {
  // GET: id ပါအောင် SELECT ထုတ်ပေးထားပါသည်
  app.get(`/api/${resource}`, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, ${definition.fields.join(', ')} FROM ${definition.table} ORDER BY id DESC`,
      );
      res.json(rows);
    } catch (error) {
      console.error(`Failed to fetch ${resource}:`, error.message);
      res.status(500).json({ success: false, message: `Failed to fetch ${resource}` });
    }
  });

  // POST: Data အသစ်ထည့်ခြင်း
  app.post(`/api/${resource}`, ...adminOnly, async (req, res) => {
    const missingFields = definition.required.filter(
      (field) => req.body[field] === undefined || req.body[field] === null || req.body[field] === '',
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(', ')}`,
      });
    }

    const fields = definition.defaultMissingFields
      ? definition.fields
      : definition.fields.filter((field) => req.body[field] !== undefined);
    const values = fields.map((field) => definition.defaultMissingFields ? req.body[field] ?? '' : req.body[field]);
    const placeholders = fields.map(() => '?').join(', ');

    try {
      const [result] = await pool.query(
        `INSERT INTO ${definition.table} (${fields.join(', ')}) VALUES (${placeholders})`,
        values,
      );
      const [rows] = await pool.query(
        `SELECT id, ${definition.fields.join(', ')} FROM ${definition.table} WHERE id = ?`,
        [result.insertId],
      );
      await logActivity(
        getAuthenticatedUserId(req.user),
        req.user.role,
        'CREATE',
        resource,
        { recordId: result.insertId, fields: req.body },
      );
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error(`Failed to create ${resource}:`, error.message);
      res.status(500).json({ success: false, message: `Failed to create ${resource}` });
    }
  });

  // PUT: Data ပြင်ဆင်ခြင်း
  app.put(`/api/${resource}/:id`, ...adminOnly, async (req, res) => {
    const recordId = Number(req.params.id);

    // ID မမှန်ပါက တားမြစ်မည်
    if (!recordId || isNaN(recordId)) {
      return res.status(400).json({ error: "Invalid record ID provided" });
    }

    let query;
    let values;

    if (resource === 'courses') {
      const title = String(req.body.title || req.body.name || '');
      const date = String(req.body.date || '');
      const time = String(req.body.time || '');
      const instructor = String(req.body.instructor || '');

      query = 'UPDATE courses SET title = ?, date = ?, time = ?, instructor = ? WHERE id = ?';
      values = [title, date, time, instructor, recordId];
    } else {
      values = definition.fields.map((field) => (
        definition.defaultMissingFields ? req.body[field] ?? '' : req.body[field]
      ));
      values.push(recordId);
      query = `UPDATE ${definition.table} SET ${definition.fields.map((field) => `${field}=?`).join(', ')} WHERE id=?`;
    }

    try {
      const [result] = await pool.query(query, values);

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `${resource} record not found` });
      }

      await logActivity(
        getAuthenticatedUserId(req.user),
        req.user.role,
        'UPDATE',
        resource,
        { recordId, fields: req.body },
      );
      res.status(200).json({ success: true, message: `${resource} record updated`, id: recordId });
    } catch (error) {
      console.error(`Failed to update ${resource}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE: Data ဖျက်ခြင်း
  app.delete(`/api/${resource}/:id`, ...adminOnly, async (req, res) => {
    try {
      const [result] = await pool.query(`DELETE FROM ${definition.table} WHERE id = ?`, [req.params.id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `${resource} record not found` });
      }

      await logActivity(
        getAuthenticatedUserId(req.user),
        req.user.role,
        'DELETE',
        resource,
        { recordId: req.params.id },
      );
      res.json({ success: true, message: `${resource} record deleted` });
    } catch (error) {
      console.error(`Failed to delete ${resource}:`, error.message);
      res.status(500).json({ success: false, message: `Failed to delete ${resource}` });
    }
  });
}

Object.entries(resourceDefinitions).forEach(([resource, definition]) => {
  addResourceRoutes(resource, definition);
});

app.get('/api/audit-logs', ...adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, user_id, user_role, action, resource, details, created_at
      FROM audit_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `);

    res.json(rows.map((row) => ({
      ...row,
      details: row.details
        ? (() => {
          try {
            return JSON.parse(row.details);
          } catch (error) {
            return row.details;
          }
        })()
        : null,
    })));
  } catch (error) {
    console.error('Failed to fetch audit logs:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
});

app.get('/api/test', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, message: 'Database connection successful' });
  } catch (error) {
    console.error('Database connection failed:', error.message);
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

if (require.main === module) {
  ensureAuditLogsTable()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
      });
    })
    .catch((error) => {
      console.error('Failed to initialize audit logs table:', error.message);
      process.exitCode = 1;
    });
}

module.exports = { app, pool };
