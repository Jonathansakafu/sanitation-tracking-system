const express = require("express")
const pool = require("../db")
const { verifyToken, requireRole } = require("../auth")
const asyncRoute = require("../asyncRoute")

const router = express.Router()

router.post("/trucks", verifyToken, requireRole("operator"), asyncRoute(async (req, res) => {
  const { plate_number, truck_type } = req.body

  if (!plate_number || !truck_type) {
    return res.status(400).json({ error: "plate_number and truck_type are required" })
  }

  const [existing] = await pool.query("SELECT id FROM trucks WHERE plate_number = ?", [plate_number.trim()])
  if (existing.length) {
    return res.status(409).json({ error: "A truck with that plate number already exists" })
  }

  await pool.query(
    "INSERT INTO trucks (plate_number, truck_type, operator_id) VALUES (?, ?, ?)",
    [plate_number.trim(), truck_type.trim(), req.user.id]
  )

  res.json({ success: true })
}))

// Scoped to the caller's own fleet via the verified token — never a
// client-supplied operator_id.
router.get("/trucks", verifyToken, requireRole("operator"), asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.*,
            r.id AS active_job_id, r.request_id AS active_job_code
     FROM trucks t
     LEFT JOIN requests r ON r.truck_id = t.id AND r.status = 'driver_assigned'
     WHERE t.operator_id = ?
     ORDER BY t.id DESC`,
    [req.user.id]
  )
  res.json(rows)
}))

router.put("/trucks/:id/status", verifyToken, requireRole("operator"), asyncRoute(async (req, res) => {
  const { status } = req.body

  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'inactive'" })
  }

  const [result] = await pool.query(
    "UPDATE trucks SET status = ? WHERE id = ? AND operator_id = ?",
    [status, req.params.id, req.user.id]
  )

  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "Truck not found or not yours" })
  }

  res.json({ success: true })
}))

router.delete("/trucks/:id", verifyToken, requireRole("operator"), asyncRoute(async (req, res) => {
  const truckId = req.params.id

  const [busy] = await pool.query(
    "SELECT id FROM requests WHERE truck_id = ? AND status = 'driver_assigned' LIMIT 1",
    [truckId]
  )
  if (busy.length) {
    return res.status(409).json({ error: "This truck is currently in use on an active job" })
  }

  const [result] = await pool.query(
    "DELETE FROM trucks WHERE id = ? AND operator_id = ?",
    [truckId, req.user.id]
  )

  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "Truck not found or not yours" })
  }

  res.json({ success: true })
}))

module.exports = router
