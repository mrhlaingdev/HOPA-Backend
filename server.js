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
