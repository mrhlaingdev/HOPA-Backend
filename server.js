require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { authenticateToken, authorizeRoles } = require('./middleware/auth');
const { createAuditLogger } = require('./middleware/auditLogger');

const app = express();
const port = Number(process.env.PORT) || 3000;

// Admin Guard (Role စာလုံးအကြီး/အသေး နှစ်မျိုးလုံး ခွင့်ပြုထားပါသည်)
const adminOnly = [authenticateToken, authorizeRoles('admin', 'ADMIN')];

// Dynamic CORS Options (Vercel subdomains အားလုံးနှင့် localhost အားလုံးကို ခွင့်ပြုခြင်း)
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || origin.includes('vercel.app') || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(null, true); // Fallback: Enable cross-origin for all deployment previews
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role', 'x-user-id', 'x-active-role', 'x-role'],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
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
    fields: ['title', 'date', 'time', 'teacher_id'],
    required: [],
    defaultMissingFields: true,
    nullableFields: ['teacher_id'],
    select: `
      SELECT c.id, c.title, c.date, c.time, c.teacher_id, t.name AS teacher_name
      FROM courses c
      LEFT JOIN teachers t ON t.id = c.teacher_id
    `,
  },
  teachers: {
    table: 'teachers',
    fields: ['name', 'phone', 'email', 'specialization'],
    required: ['name'],
  },
  staff: {
    table: 'staff',
    fields: ['name', 'phone', 'position', 'salary'],
    required: ['name'],
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
  // GET: Public သို့မဟုတ် Authentication လွယ်ကူစွာ ရယူရန် ခွင့်ပြုထားသည်
  app.get(`/api/${resource}`, async (req, res) => {
    try {
      const [rows] = await pool.query(
        definition.select
          ? `${definition.select} ORDER BY c.id DESC`
          : `SELECT id, ${definition.fields.join(', ')} FROM ${definition.table} ORDER BY id DESC`,
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
    const values = fields.map((field) => {
      if (!definition.defaultMissingFields) {
        return req.body[field];
      }

      if (definition.nullableFields?.includes(field) && (req.body[field] === undefined || req.body[field] === null || req.body[field] === '')) {
        return null;
      }

      return req.body[field] ?? '';
    });
    const placeholders = fields.map(() => '?').join(', ');

    try {
      const [result] = await pool.query(
        `INSERT INTO ${definition.table} (${fields.join(', ')}) VALUES (${placeholders})`,
        values,
      );
      const [rows] = await pool.query(
        definition.select
          ? `${definition.select} WHERE c.id = ?`
          : `SELECT id, ${definition.fields.join(', ')} FROM ${definition.table} WHERE id = ?`,
        [result.insertId],
      );
      await logActivity(
        getAuthenticatedUserId(req.user),
        req.user?.role || 'admin',
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

    if (!recordId || isNaN(recordId)) {
      return res.status(400).json({ error: "Invalid record ID provided" });
    }

    let values = definition.fields.map((field) => (
      definition.defaultMissingFields
        ? definition.nullableFields?.includes(field) && (req.body[field] === undefined || req.body[field] === null || req.body[field] === '')
          ? null
          : req.body[field] ?? ''
        : req.body[field]
    ));
    values.push(recordId);
    let query = `UPDATE ${definition.table} SET ${definition.fields.map((field) => `${field}=?`).join(', ')} WHERE id=?`;

    try {
      const [result] = await pool.query(query, values);

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `${resource} record not found` });
      }

      await logActivity(
        getAuthenticatedUserId(req.user),
        req.user?.role || 'admin',
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
        req.user?.role || 'admin',
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

// Attendance အတွက် သီးခြား Upsert Route (student_name + date နဲ့ ရှာပြီး
// ရှိပြီးသားဆိုရင် update, မရှိသေးရင် အသစ်ဖန်တီးပါတယ်)
// ဒီ route ကို generic PUT /api/attendance/:id route မတိုင်ခင် ထားထားပါတယ်
app.put('/api/attendance', ...adminOnly, async (req, res) => {
  const { student_name, date, status, remarks } = req.body;

  if (!student_name || !date) {
    return res.status(400).json({
      success: false,
      message: 'student_name and date are required',
    });
  }

  try {
    const [existing] = await pool.query(
      'SELECT id FROM attendance WHERE student_name = ? AND date = ?',
      [student_name, date],
    );

    if (existing.length > 0) {
      await pool.query(
        'UPDATE attendance SET status = ?, remarks = ? WHERE id = ?',
        [status ?? null, remarks ?? null, existing[0].id],
      );
    } else {
      await pool.query(
        'INSERT INTO attendance (student_name, date, status, remarks) VALUES (?, ?, ?, ?)',
        [student_name, date, status ?? null, remarks ?? null],
      );
    }

    await logActivity(
      getAuthenticatedUserId(req.user),
      req.user?.role || 'admin',
      'UPDATE',
      'attendance',
      { student_name, date, status },
    );

    res.status(200).json({ success: true, message: 'Attendance updated' });
  } catch (error) {
    console.error('Failed to update attendance:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update attendance' });
  }
});

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
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  ensureAuditLogsTable().catch((error) => {
    console.error('Failed to initialize audit logs table:', error.message);
  });
}

module.exports = { app, pool };