const express = require("express")
const bcrypt = require("bcryptjs")
const pool = require("../db")
const { signToken, verifyToken } = require("../auth")
const asyncRoute = require("../asyncRoute")

const router = express.Router()

const TABLE_BY_ROLE = { admin: "users", customer: "users", driver: "drivers", operator: "operators" }

function normalizeWard(ward) {
  return ward.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

router.post("/register", asyncRoute(async (req, res) => {
  const { username, password, fullname, phone, ward } = req.body

  if (!username || !password || !fullname || !phone || !ward) {
    return res.status(400).json({ error: "Fullname, phone, ward, username and password are required" })
  }

  const [existingUsers] = await pool.query("SELECT id FROM users WHERE username = ?", [username])
  const [existingDrivers] = await pool.query("SELECT id FROM drivers WHERE username = ?", [username])
  const [existingOperators] = await pool.query("SELECT id FROM operators WHERE username = ?", [username])

  if (existingUsers.length || existingDrivers.length || existingOperators.length) {
    return res.status(409).json({ error: "Username already taken" })
  }

  const hashed = await bcrypt.hash(password, 10)
  const trimmedFullname = fullname.trim()
  const [result] = await pool.query(
    "INSERT INTO users (username, password, role, fullname, phone, ward) VALUES (?, ?, 'customer', ?, ?, ?)",
    [username, hashed, trimmedFullname, phone.trim(), normalizeWard(ward)]
  )

  // Log the new resident straight in, matching what /login returns, so the
  // frontend can land them directly on their dashboard without a second round trip.
  const token = signToken({ id: result.insertId, username, role: "customer" })

  res.json({
    success: true,
    role: "customer",
    token,
    user: {
      id: result.insertId,
      username,
      role: "customer",
      fullname: trimmedFullname,
      operator_id: null,
      token
    }
  })
}))

router.post("/login", asyncRoute(async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" })
  }

  const [drivers] = await pool.query("SELECT * FROM drivers WHERE username = ?", [username])
  const [operators] = await pool.query("SELECT * FROM operators WHERE username = ?", [username])
  const [users] = await pool.query("SELECT * FROM users WHERE username = ?", [username])

  const account = drivers[0]
    ? { ...drivers[0], role: "driver" }
    : operators[0]
      ? { ...operators[0], role: "operator" }
      : users[0]

  if (!account) {
    return res.status(401).json({ error: "Invalid username or password" })
  }

  if (account.role === "operator" && account.status === "suspended") {
    return res.status(403).json({ error: "Your account has been suspended" })
  }

  const valid = await bcrypt.compare(password, account.password)
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password" })
  }

  const token = signToken({ id: account.id, username: account.username, role: account.role })

  res.json({
    success: true,
    role: account.role,
    token,
    user: {
      id: account.id,
      username: account.username,
      role: account.role,
      fullname: account.fullname || null,
      operator_id: account.operator_id ?? null,
      token
    }
  })
}))

router.put("/users/change-password", verifyToken, asyncRoute(async (req, res) => {
  const { oldPassword, newPassword } = req.body
  const { id, role } = req.user

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "Old and new password are required" })
  }

  const table = TABLE_BY_ROLE[role]
  if (!table) {
    return res.status(400).json({ error: "Invalid account type" })
  }

  const [rows] = await pool.query(`SELECT password FROM ${table} WHERE id = ?`, [id])
  const account = rows[0]
  if (!account) {
    return res.status(404).json({ error: "Account not found" })
  }

  const valid = await bcrypt.compare(oldPassword, account.password)
  if (!valid) {
    return res.status(400).json({ error: "Incorrect current password" })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  await pool.query(`UPDATE ${table} SET password = ? WHERE id = ?`, [hashed, id])

  res.json({ success: true })
}))

module.exports = router
