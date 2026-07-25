const express = require("express")
const pool = require("../db")
const { verifyToken, requireRole } = require("../auth")
const asyncRoute = require("../asyncRoute")

const router = express.Router()

// Two payment paths coexist:
// - Legacy / no-operator jobs (assigned directly by admin): driver marks paid
//   immediately, same as before this feature existed — there's no operator
//   around to approve a claim, so approval would never resolve.
// - Operator-claimed jobs: driver "claims" cash received -> pending_confirmation,
//   then the owning operator approves/rejects (see /approve, /reject below).
router.put("/payment/:id", verifyToken, requireRole("admin", "driver"), asyncRoute(async (req, res) => {
  const id = req.params.id

  if (req.user.role === "admin") {
    await pool.query("UPDATE requests SET paymentStatus = 'paid' WHERE id = ?", [id])
    return res.json({ success: true })
  }

  const [rows] = await pool.query(
    "SELECT driver_id, operator_id, status, confirmation_status, paymentMethod, paymentStatus FROM requests WHERE id = ?",
    [id]
  )
  const request = rows[0]

  if (!request || request.driver_id !== req.user.id) {
    return res.status(404).json({ error: "Request not found" })
  }

  if (!request.operator_id) {
    await pool.query("UPDATE requests SET paymentStatus = 'paid' WHERE id = ?", [id])
    return res.json({ success: true })
  }

  const [result] = await pool.query(
    `UPDATE requests SET paymentStatus = 'pending_confirmation'
     WHERE id = ? AND status = 'completed'
       AND confirmation_status IN ('resident_confirmed', 'operator_confirmed')
       AND paymentMethod = 'cash' AND paymentStatus = 'unpaid'`,
    [id]
  )

  if (result.affectedRows === 0) {
    if (request.status !== "completed") {
      return res.status(409).json({ error: "Job must be completed before claiming payment" })
    }
    if (request.confirmation_status === "pending") {
      return res.status(409).json({ error: "Waiting for the job completion to be confirmed first" })
    }
    if (request.paymentMethod !== "cash") {
      return res.status(409).json({ error: "Online payments are confirmed automatically" })
    }
    return res.status(409).json({ error: "Payment for this job is already " + request.paymentStatus })
  }

  res.json({ success: true, message: "Payment claim submitted — waiting for operator approval" })
}))

router.put("/payment/:id/approve", verifyToken, requireRole("operator"), asyncRoute(async (req, res) => {
  const [result] = await pool.query(
    "UPDATE requests SET paymentStatus = 'paid' WHERE id = ? AND operator_id = ? AND paymentStatus = 'pending_confirmation'",
    [req.params.id, req.user.id]
  )

  if (result.affectedRows === 0) {
    return res.status(409).json({ error: "No pending payment claim found for this job under your account" })
  }

  res.json({ success: true })
}))

router.put("/payment/:id/reject", verifyToken, requireRole("operator"), asyncRoute(async (req, res) => {
  const [result] = await pool.query(
    "UPDATE requests SET paymentStatus = 'unpaid' WHERE id = ? AND operator_id = ? AND paymentStatus = 'pending_confirmation'",
    [req.params.id, req.user.id]
  )

  if (result.affectedRows === 0) {
    return res.status(409).json({ error: "No pending payment claim found for this job under your account" })
  }

  res.json({ success: true })
}))

module.exports = router
