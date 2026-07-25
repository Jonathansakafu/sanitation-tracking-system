const express = require("express")
const bcrypt = require("bcryptjs")
const pool = require("../db")
const { verifyToken, requireRole } = require("../auth")
const asyncRoute = require("../asyncRoute")

const router = express.Router()

router.get("/drivers", verifyToken, requireRole("admin", "operator"), asyncRoute(async (req, res) => {
  let sql = "SELECT id, fullname, phone, truck_number, username, status, operator_id FROM drivers"
  const params = []

  if (req.user.role === "operator") {
    sql += " WHERE operator_id = ?"
    params.push(req.user.id)
  }

  sql += " ORDER BY id DESC"

  const [rows] = await pool.query(sql, params)
  res.json(rows)
}))

router.post("/drivers", verifyToken, requireRole("admin", "operator"), asyncRoute(async (req, res) => {
  const { fullname, phone, truck_number, username, password } = req.body

  if (!fullname || !phone || !username || !password) {
    return res.status(400).json({ error: "All fields are required" })
  }

  const [existingDrivers] = await pool.query("SELECT id FROM drivers WHERE username = ?", [username])
  const [existingUsers] = await pool.query("SELECT id FROM users WHERE username = ?", [username])
  const [existingOperators] = await pool.query("SELECT id FROM operators WHERE username = ?", [username])

  if (existingDrivers.length || existingUsers.length || existingOperators.length) {
    return res.status(409).json({ error: "Username already taken" })
  }

  // operator_id is only ever taken from the verified token, never the body —
  // an operator cannot plant a driver into another operator's fleet.
  const operatorId = req.user.role === "operator" ? req.user.id : null
  const hashed = await bcrypt.hash(password, 10)

  await pool.query(
    "INSERT INTO drivers (fullname, phone, truck_number, username, password, status, operator_id) VALUES (?, ?, ?, ?, ?, 'available', ?)",
    [fullname, phone, truck_number || null, username, hashed, operatorId]
  )

  res.json({ success: true })
}))

module.exports = router
