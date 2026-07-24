const bcrypt = require("bcryptjs")
const pool = require("./db")

const BCRYPT_PATTERN = /^\$2[aby]\$/

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
  await ensurePaymentMethodColumn()
  await hashPlaintextPasswords("users")
  await hashPlaintextPasswords("drivers")
  await ensureDefaultAdmin()
}

module.exports = runMigrations
