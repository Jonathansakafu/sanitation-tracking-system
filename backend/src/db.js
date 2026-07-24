const mysql = require("mysql2/promise")

// Supports both our own DB_* env vars (local/.env) and the MYSQL* names
// that hosting platforms like Railway auto-inject when you attach a MySQL plugin.
const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST,
  port: process.env.DB_PORT || process.env.MYSQLPORT,
  user: process.env.DB_USER || process.env.MYSQLUSER,
  password: process.env.DB_PASSWORD ?? process.env.MYSQLPASSWORD,
  database: process.env.DB_NAME || process.env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: 10
})

module.exports = pool
