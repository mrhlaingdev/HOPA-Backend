require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT) || 3000;

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
    fields: ['student_id', 'date', 'status'],
    required: ['student_id', 'date'],
  },
  finance: {
    table: 'finance',
    fields: ['type', 'amount', 'category', 'description', 'date'],
    required: ['type', 'amount', 'category', 'date'],
  },
};

function addResourceRoutes(resource, definition) {
  app.get(`/api/${resource}`, async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM ${definition.table} ORDER BY id DESC`);
      res.json(rows);
    } catch (error) {
      console.error(`Failed to fetch ${resource}:`, error.message);
      res.status(500).json({ success: false, message: `Failed to fetch ${resource}` });
    }
  });

  app.post(`/api/${resource}`, async (req, res) => {
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
      const [rows] = await pool.query(`SELECT * FROM ${definition.table} WHERE id = ?`, [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error(`Failed to create ${resource}:`, error.message);
      res.status(500).json({ success: false, message: `Failed to create ${resource}` });
    }
  });

  app.put(`/api/${resource}/:id`, async (req, res) => {
    const values = definition.fields.map((field) => (
      definition.defaultMissingFields ? req.body[field] ?? '' : req.body[field]
    ));
    values.push(req.params.id);

    try {
      const [result] = await pool.query(
        `UPDATE ${definition.table} SET ${definition.fields.map((field) => `${field}=?`).join(', ')} WHERE id=?`,
        values,
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `${resource} record not found` });
      }

      res.json({ success: true, message: `${resource} record updated` });
    } catch (error) {
      console.error(`Failed to update ${resource}:`, error.message);
      res.status(500).json({ success: false, message: `Failed to update ${resource}` });
    }
  });

  app.delete(`/api/${resource}/:id`, async (req, res) => {
    try {
      const [result] = await pool.query(`DELETE FROM ${definition.table} WHERE id = ?`, [req.params.id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `${resource} record not found` });
      }

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

app.get('/api/test', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, message: 'Database connection successful' });
  } catch (error) {
    console.error('Database connection failed:', error.message);
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
