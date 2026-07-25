const bcrypt = require("bcryptjs")
const pool = require("./db")

const BCRYPT_PATTERN = /^\$2[aby]\$/

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT,
      username VARCHAR(100) NOT NULL,
      password VARCHAR(100) NOT NULL,
      role VARCHAR(20) DEFAULT 'customer',
      PRIMARY KEY (id),
      UNIQUE KEY username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INT NOT NULL AUTO_INCREMENT,
      fullname VARCHAR(100) DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      truck_number VARCHAR(50) DEFAULT NULL,
      username VARCHAR(100) DEFAULT NULL,
      password VARCHAR(100) DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'available',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id INT NOT NULL AUTO_INCREMENT,
      request_id VARCHAR(50) DEFAULT NULL,
      user VARCHAR(100) DEFAULT NULL,
      name VARCHAR(100) DEFAULT NULL,
      phone VARCHAR(20) DEFAULT NULL,
      service VARCHAR(100) DEFAULT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      paymentStatus VARCHAR(50) DEFAULT 'unpaid',
      paymentMethod VARCHAR(20) DEFAULT 'cash',
      amount INT DEFAULT NULL,
      lat DOUBLE DEFAULT NULL,
      lng DOUBLE DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      driver VARCHAR(100) DEFAULT NULL,
      priority VARCHAR(20) DEFAULT 'normal',
      proof_image TEXT DEFAULT NULL,
      completed TINYINT(1) DEFAULT 0,
      completed_at TIMESTAMP NULL DEFAULT NULL,
      assigned_driver VARCHAR(100) DEFAULT NULL,
      urgency VARCHAR(20) DEFAULT 'normal',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      id INT NOT NULL AUTO_INCREMENT,
      fullname VARCHAR(100) DEFAULT NULL,
      business_name VARCHAR(150) NOT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      ewura_license VARCHAR(100) DEFAULT NULL,
      username VARCHAR(100) NOT NULL,
      password VARCHAR(255) NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      suspension_reason TEXT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trucks (
      id INT NOT NULL AUTO_INCREMENT,
      plate_number VARCHAR(30) NOT NULL,
      truck_type VARCHAR(50) DEFAULT NULL,
      operator_id INT DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY plate_number (plate_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
}

// Idempotent "add column if missing" helper, driven by a table + column-def list
// (mirrors the shape of information_schema checks already used by
// ensurePaymentMethodColumn, generalized so ~10 new columns across 3 tables
// don't need one copy-pasted function each).
async function ensureColumns(table, columns) {
  const [existing] = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  )
  const existingNames = new Set(existing.map((row) => row.column_name.toLowerCase()))

  for (const { name, definition } of columns) {
    if (!existingNames.has(name.toLowerCase())) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
      console.log(`Migration: added column '${name}' to '${table}'`)
    }
  }
}

async function ensurePaymentMethodColumn() {
  await ensureColumns("requests", [
    { name: "paymentMethod", definition: "VARCHAR(20) DEFAULT 'cash'" }
  ])
}

async function ensureUserProfileColumns() {
  await ensureColumns("users", [
    { name: "fullname", definition: "VARCHAR(100) DEFAULT NULL" },
    { name: "phone", definition: "VARCHAR(30) DEFAULT NULL" },
    { name: "ward", definition: "VARCHAR(100) DEFAULT NULL" }
  ])
}

async function ensureDriverOperatorColumn() {
  await ensureColumns("drivers", [
    { name: "operator_id", definition: "INT DEFAULT NULL" }
  ])
}

async function ensureRequestWorkflowColumns() {
  await ensureColumns("requests", [
    { name: "operator_id", definition: "INT DEFAULT NULL" },
    { name: "driver_id", definition: "INT DEFAULT NULL" },
    { name: "truck_id", definition: "INT DEFAULT NULL" },
    { name: "notes", definition: "TEXT DEFAULT NULL" },
    { name: "confirmation_status", definition: "VARCHAR(30) DEFAULT 'pending'" },
    { name: "resident_comment", definition: "TEXT DEFAULT NULL" },
    { name: "site_image", definition: "VARCHAR(255) DEFAULT NULL" }
  ])
}

async function hashPlaintextPasswords(table) {
  const [rows] = await pool.query(`SELECT id, password FROM ${table}`)
  for (const row of rows) {
    if (!BCRYPT_PATTERN.test(row.password)) {
      const hashed = await bcrypt.hash(row.password, 10)
      await pool.query(`UPDATE ${table} SET password = ? WHERE id = ?`, [hashed, row.id])
    }
  }
}

// One-time (but safe-to-repeat) backfill: older rows only recorded the
// assigned driver as a username string (assigned_driver). New code reads
// driver_id (numeric FK) exclusively, so every boot we fill in driver_id
// for any row that has an assigned_driver but no driver_id yet — never
// touching rows that already have driver_id set.
async function backfillDriverIdFromAssignedDriver() {
  const [result] = await pool.query(`
    UPDATE requests r
    JOIN drivers d ON d.username = r.assigned_driver
    SET r.driver_id = d.id
    WHERE r.driver_id IS NULL AND r.assigned_driver IS NOT NULL
  `)
  if (result.affectedRows > 0) {
    console.log(`Migration: backfilled driver_id for ${result.affectedRows} request(s) from assigned_driver`)
  }
}

async function ensureDefaultAdmin() {
  const [rows] = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)
  if (rows.length === 0) {
    const hashed = await bcrypt.hash("admin123", 10)
    await pool.query(
      `INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')`,
      ["admin", hashed]
    )
    console.log('No admin account found — created default admin (username: "admin", password: "admin123"). Please change this password.')
  }
}

async function runMigrations() {
  await ensureTables()
  await ensurePaymentMethodColumn()
  await ensureUserProfileColumns()
  await ensureDriverOperatorColumn()
  await ensureRequestWorkflowColumns()
  await hashPlaintextPasswords("users")
  await hashPlaintextPasswords("drivers")
  await hashPlaintextPasswords("operators")
  await backfillDriverIdFromAssignedDriver()
  await ensureDefaultAdmin()
}

module.exports = runMigrations
