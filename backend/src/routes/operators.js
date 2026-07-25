const express = require("express")
const bcrypt = require("bcryptjs")
const pool = require("../db")
const { verifyToken, requireRole } = require("../auth")
const asyncRoute = require("../asyncRoute")

const router = express.Router()

router.post("/authority/register-operator", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const { fullname, business_name, phone, ewura_license, username, password } = req.body

  if (!fullname || !business_name || !phone || !ewura_license || !username || !password) {
    return res.status(400).json({ error: "All fields are required" })
  }

  const [existingUsers] = await pool.query("SELECT id FROM users WHERE username = ?", [username])
  const [existingDrivers] = await pool.query("SELECT id FROM drivers WHERE username = ?", [username])
  const [existingOperators] = await pool.query("SELECT id FROM operators WHERE username = ?", [username])

  if (existingUsers.length || existingDrivers.length || existingOperators.length) {
    return res.status(409).json({ error: "Username already taken" })
  }

  const hashed = await bcrypt.hash(password, 10)
  await pool.query(
    `INSERT INTO operators (fullname, business_name, phone, ewura_license, username, password, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [fullname, business_name, phone, ewura_license, username, hashed]
  )

  res.json({ success: true })
}))

// Includes completion-rate stats per operator — used by the admin dashboard
// to inform suspension/reinstatement decisions.
router.get("/operators", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const [operators] = await pool.query(`
    SELECT o.*,
           COUNT(r.id) AS total_requests,
           SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completed_requests
    FROM operators o
    LEFT JOIN requests r ON r.operator_id = o.id
    GROUP BY o.id
    ORDER BY o.id DESC
  `)
  res.json(operators)
}))

// Minimal, non-sensitive lookup — used by driver.html to show the
// driver's own operator's business name.
router.get("/operators/:id", verifyToken, asyncRoute(async (req, res) => {
  const [rows] = await pool.query("SELECT id, business_name FROM operators WHERE id = ?", [req.params.id])
  if (!rows.length) {
    return res.status(404).json({ error: "Operator not found" })
  }
  res.json(rows[0])
}))

router.put("/operators/:id/status", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const { status, suspension_reason } = req.body

  if (!["active", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'suspended'" })
  }

  await pool.query(
    "UPDATE operators SET status = ?, suspension_reason = ? WHERE id = ?",
    [status, suspension_reason || null, req.params.id]
  )

  res.json({ success: true })
}))

// Orphans (rather than deletes) the operator's drivers/trucks so historical
// requests they worked on remain resolvable via JOIN.
router.delete("/operators/:id", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const id = req.params.id

  await pool.query("UPDATE drivers SET operator_id = NULL WHERE operator_id = ?", [id])
  await pool.query("UPDATE trucks SET operator_id = NULL WHERE operator_id = ?", [id])
  await pool.query("DELETE FROM operators WHERE id = ?", [id])

  res.json({ success: true })
}))

module.exports = router
