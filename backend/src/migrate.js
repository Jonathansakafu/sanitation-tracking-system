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

async function ensurePaymentMethodColumn() {
  const [cols] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'requests' AND column_name = 'paymentMethod'`
  )
  if (cols[0].c === 0) {
    await pool.query(
      `ALTER TABLE requests ADD COLUMN paymentMethod VARCHAR(20) DEFAULT 'cash'`
    )
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
  await hashPlaintextPasswords("users")
  await hashPlaintextPasswords("drivers")
  await ensureDefaultAdmin()
}

module.exports = runMigrations
