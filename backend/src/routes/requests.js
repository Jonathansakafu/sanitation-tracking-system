const express = require("express")
const fs = require("fs")
const path = require("path")
const pool = require("../db")
const { verifyToken, requireRole } = require("../auth")
const asyncRoute = require("../asyncRoute")
const { upload, UPLOADS_DIR } = require("../upload")
const { SERVICE_PRICES } = require("../prices")

const router = express.Router()

router.get("/requests", verifyToken, asyncRoute(async (req, res) => {
  let sql = `
    SELECT r.*,
           u.ward AS ward,
           o.business_name AS operator_business_name,
           t.plate_number AS truck_plate, t.truck_type AS truck_type
    FROM requests r
    LEFT JOIN users u ON u.username = r.user
    LEFT JOIN operators o ON o.id = r.operator_id
    LEFT JOIN trucks t ON t.id = r.truck_id
  `
  const params = []

  if (req.user.role === "driver") {
    sql += " WHERE r.driver_id = ?"
    params.push(req.user.id)
  } else if (req.user.role === "operator") {
    sql += " WHERE (r.operator_id = ? OR r.operator_id IS NULL)"
    params.push(req.user.id)
  } else if (req.user.role !== "admin") {
    sql += " WHERE r.user = ?"
    params.push(req.user.username)
  }

  sql += " ORDER BY r.created_at DESC"

  const [rows] = await pool.query(sql, params)
  res.json(rows)
}))

router.post("/requests", verifyToken, requireRole("customer"), upload.single("site_image"), asyncRoute(async (req, res) => {
  const { name, phone, service, paymentMethod, lat, lng, notes } = req.body

  if (!name || !phone || !service) {
    return res.status(400).json({ error: "Name, phone and service are required" })
  }

  const amount = SERVICE_PRICES[service]
  if (amount === undefined) {
    return res.status(400).json({ error: "Unknown service" })
  }

  const siteImage = req.file ? req.file.filename : null
  const requestId = "REQ-" + Date.now()

  await pool.query(
    `INSERT INTO requests
       (request_id, user, name, phone, service, amount, paymentMethod, paymentStatus, status, lat, lng, notes, site_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', 'pending', ?, ?, ?, ?)`,
    [requestId, req.user.username, name, phone, service, amount, paymentMethod || "cash", lat ?? null, lng ?? null, notes || null, siteImage]
  )

  res.json({ success: true })
}))

// Admin: assign by driver username (legacy path, unchanged behavior).
// Operator: claim/assign by driver_id + optional truck_id, scoped to the
// operator's own fleet and guarded against re-claiming/double-booking.
router.put("/assign-driver/:id", verifyToken, requireRole("admin", "operator"), asyncRoute(async (req, res) => {
  const id = req.params.id

  if (req.user.role === "admin") {
    const { assigned_driver } = req.body

    const [drivers] = await pool.query("SELECT id FROM drivers WHERE username = ?", [assigned_driver])
    if (!drivers.length) {
      return res.status(400).json({ error: "Driver not found" })
    }

    await pool.query(
      "UPDATE requests SET assigned_driver = ?, driver_id = ? WHERE id = ?",
      [assigned_driver, drivers[0].id, id]
    )
    return res.json({ success: true })
  }

  // operator path
  const { driver_id, truck_id } = req.body
  if (!driver_id) {
    return res.status(400).json({ error: "driver_id is required" })
  }

  const [ownDrivers] = await pool.query(
    "SELECT id, username FROM drivers WHERE id = ? AND operator_id = ?",
    [driver_id, req.user.id]
  )
  if (!ownDrivers.length) {
    return res.status(400).json({ error: "Driver not found in your fleet" })
  }

  let truckIdValue = null
  if (truck_id) {
    const [ownTrucks] = await pool.query(
      "SELECT id FROM trucks WHERE id = ? AND operator_id = ?",
      [truck_id, req.user.id]
    )
    if (!ownTrucks.length) {
      return res.status(400).json({ error: "Truck not found in your fleet" })
    }

    const [busyTrucks] = await pool.query(
      "SELECT id FROM requests WHERE truck_id = ? AND status = 'driver_assigned' AND id <> ?",
      [truck_id, id]
    )
    if (busyTrucks.length) {
      return res.status(409).json({ error: "That truck is already in use on another active job" })
    }
    truckIdValue = truck_id
  }

  const [result] = await pool.query(
    `UPDATE requests
     SET operator_id = ?, driver_id = ?, assigned_driver = ?, truck_id = ?, status = 'driver_assigned'
     WHERE id = ? AND (operator_id IS NULL OR operator_id = ?)`,
    [req.user.id, driver_id, ownDrivers[0].username, truckIdValue, id, req.user.id]
  )

  if (result.affectedRows === 0) {
    return res.status(409).json({ error: "This job was already claimed by another operator, or doesn't exist" })
  }

  res.json({ success: true })
}))

router.post("/upload-proof/:id", verifyToken, requireRole("driver"), upload.single("proof"), asyncRoute(async (req, res) => {
  const [rows] = await pool.query("SELECT driver_id FROM requests WHERE id = ?", [req.params.id])
  const request = rows[0]

  const rejectAndCleanup = (status, error) => {
    if (req.file) fs.unlink(req.file.path, () => {})
    return res.status(status).json({ error })
  }

  if (!request) {
    return rejectAndCleanup(404, "Request not found")
  }

  if (request.driver_id !== req.user.id) {
    return rejectAndCleanup(403, "Not your request")
  }

  if (!req.file) {
    return res.status(400).json({ error: "Photo is required" })
  }

  await pool.query(
    `UPDATE requests SET proof_image = ?, status = 'completed', completed = 1, completed_at = NOW() WHERE id = ?`,
    [req.file.filename, req.params.id]
  )

  res.json({ success: true })
}))

router.put("/requests/:id/confirm-completion", verifyToken, requireRole("customer"), asyncRoute(async (req, res) => {
  const [result] = await pool.query(
    `UPDATE requests
     SET confirmation_status = 'resident_confirmed',
         paymentStatus = CASE WHEN paymentMethod = 'online' THEN 'paid' ELSE paymentStatus END
     WHERE id = ? AND user = ? AND status = 'completed' AND confirmation_status = 'pending'`,
    [req.params.id, req.user.username]
  )

  if (result.affectedRows === 0) {
    return res.status(409).json({ error: "Not awaiting confirmation, or not your request" })
  }

  res.json({ success: true })
}))

router.put("/requests/:id/operator-confirm-completion", verifyToken, requireRole("operator"), asyncRoute(async (req, res) => {
  const [result] = await pool.query(
    `UPDATE requests
     SET confirmation_status = 'operator_confirmed',
         paymentStatus = CASE WHEN paymentMethod = 'online' THEN 'paid' ELSE paymentStatus END
     WHERE id = ? AND operator_id = ? AND status = 'completed' AND confirmation_status = 'pending'`,
    [req.params.id, req.user.id]
  )

  if (result.affectedRows === 0) {
    return res.status(409).json({ error: "Unable to confirm — not found, not yours, not completed, or already confirmed" })
  }

  res.json({ success: true })
}))

router.put("/requests/:id/comment", verifyToken, requireRole("customer"), asyncRoute(async (req, res) => {
  const { comment } = req.body

  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: "Comment cannot be empty" })
  }

  const [result] = await pool.query(
    "UPDATE requests SET resident_comment = ? WHERE id = ? AND user = ? AND status = 'completed'",
    [comment.trim(), req.params.id, req.user.username]
  )

  if (result.affectedRows === 0) {
    return res.status(400).json({ error: "Request not found, not yours, or not yet completed" })
  }

  res.json({ success: true })
}))

router.delete("/requests/:id", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const [rows] = await pool.query("SELECT proof_image, site_image FROM requests WHERE id = ?", [req.params.id])
  const request = rows[0]

  await pool.query("DELETE FROM requests WHERE id = ?", [req.params.id])

  if (request) {
    if (request.proof_image) fs.unlink(path.join(UPLOADS_DIR, request.proof_image), () => {})
    if (request.site_image) fs.unlink(path.join(UPLOADS_DIR, request.site_image), () => {})
  }

  res.json({ success: true })
}))

module.exports = router
