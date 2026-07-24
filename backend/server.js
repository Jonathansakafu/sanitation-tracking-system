require("dotenv").config()

const path = require("path")
const fs = require("fs")
const express = require("express")
const cors = require("cors")
const multer = require("multer")
const bcrypt = require("bcryptjs")

const pool = require("./src/db")
const runMigrations = require("./src/migrate")
const { signToken, verifyToken, requireRole } = require("./src/auth")

const app = express()

app.use(cors())
app.use(express.json())

const UPLOADS_DIR = path.join(__dirname, "uploads")
app.use("/uploads", express.static(UPLOADS_DIR))
app.use(express.static(path.join(__dirname, "public")))

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"))
    }
    cb(null, true)
  }
})

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err)
    res.status(500).json({ error: "Server error" })
  })
}

// ===================== AUTH =====================

app.post("/api/register", asyncRoute(async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" })
  }

  const [existingUsers] = await pool.query("SELECT id FROM users WHERE username = ?", [username])
  const [existingDrivers] = await pool.query("SELECT id FROM drivers WHERE username = ?", [username])

  if (existingUsers.length || existingDrivers.length) {
    return res.status(409).json({ error: "Username already taken" })
  }

  const hashed = await bcrypt.hash(password, 10)
  await pool.query(
    "INSERT INTO users (username, password, role) VALUES (?, ?, 'customer')",
    [username, hashed]
  )

  res.json({ success: true })
}))

app.post("/api/login", asyncRoute(async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" })
  }

  const [drivers] = await pool.query("SELECT * FROM drivers WHERE username = ?", [username])
  const account = drivers[0]
    ? { ...drivers[0], role: "driver" }
    : (await pool.query("SELECT * FROM users WHERE username = ?", [username]))[0][0]

  if (!account) {
    return res.status(401).json({ error: "Invalid username or password" })
  }

  const valid = await bcrypt.compare(password, account.password)
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password" })
  }

  const token = signToken({ username: account.username, role: account.role })

  res.json({
    success: true,
    role: account.role,
    token,
    user: { username: account.username, role: account.role, token }
  })
}))

// ===================== REQUESTS =====================

app.get("/api/requests", verifyToken, asyncRoute(async (req, res) => {
  let sql = "SELECT * FROM requests"
  let params = []

  if (req.user.role === "driver") {
    sql += " WHERE assigned_driver = ?"
    params = [req.user.username]
  } else if (req.user.role !== "admin") {
    sql += " WHERE user = ?"
    params = [req.user.username]
  }

  sql += " ORDER BY created_at DESC"

  const [rows] = await pool.query(sql, params)
  res.json(rows)
}))

app.post("/api/requests", verifyToken, asyncRoute(async (req, res) => {
  const { name, phone, service, amount, paymentMethod, lat, lng } = req.body

  if (!name || !phone || !service) {
    return res.status(400).json({ error: "Name, phone and service are required" })
  }

  await pool.query(
    `INSERT INTO requests (user, name, phone, service, amount, paymentMethod, paymentStatus, status, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, 'unpaid', 'pending', ?, ?)`,
    [req.user.username, name, phone, service, amount || 0, paymentMethod || "cash", lat ?? null, lng ?? null]
  )

  res.json({ success: true })
}))

app.put("/api/assign-driver/:id", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const { assigned_driver } = req.body

  const [drivers] = await pool.query("SELECT id FROM drivers WHERE username = ?", [assigned_driver])
  if (!drivers.length) {
    return res.status(400).json({ error: "Driver not found" })
  }

  await pool.query("UPDATE requests SET assigned_driver = ? WHERE id = ?", [assigned_driver, req.params.id])
  res.json({ success: true })
}))

app.put("/api/payment/:id", verifyToken, requireRole("admin", "driver"), asyncRoute(async (req, res) => {
  const [rows] = await pool.query("SELECT assigned_driver FROM requests WHERE id = ?", [req.params.id])
  const request = rows[0]

  if (!request) {
    return res.status(404).json({ error: "Request not found" })
  }

  if (req.user.role === "driver" && request.assigned_driver !== req.user.username) {
    return res.status(403).json({ error: "Not your request" })
  }

  await pool.query("UPDATE requests SET paymentStatus = 'paid' WHERE id = ?", [req.params.id])
  res.json({ success: true })
}))

app.post("/api/upload-proof/:id", verifyToken, requireRole("driver"), upload.single("proof"), asyncRoute(async (req, res) => {
  const [rows] = await pool.query("SELECT assigned_driver FROM requests WHERE id = ?", [req.params.id])
  const request = rows[0]

  const rejectAndCleanup = (status, error) => {
    if (req.file) fs.unlink(req.file.path, () => {})
    return res.status(status).json({ error })
  }

  if (!request) {
    return rejectAndCleanup(404, "Request not found")
  }

  if (request.assigned_driver !== req.user.username) {
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

app.delete("/api/requests/:id", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const [rows] = await pool.query("SELECT proof_image FROM requests WHERE id = ?", [req.params.id])
  const request = rows[0]

  await pool.query("DELETE FROM requests WHERE id = ?", [req.params.id])

  if (request && request.proof_image) {
    fs.unlink(path.join(UPLOADS_DIR, request.proof_image), () => {})
  }

  res.json({ success: true })
}))

// ===================== DRIVERS =====================

app.get("/api/drivers", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, fullname, phone, truck_number, username, status FROM drivers"
  )
  res.json(rows)
}))

app.post("/api/drivers", verifyToken, requireRole("admin"), asyncRoute(async (req, res) => {
  const { fullname, phone, truck_number, username, password } = req.body

  if (!fullname || !phone || !truck_number || !username || !password) {
    return res.status(400).json({ error: "All fields are required" })
  }

  const [existingDrivers] = await pool.query("SELECT id FROM drivers WHERE username = ?", [username])
  const [existingUsers] = await pool.query("SELECT id FROM users WHERE username = ?", [username])

  if (existingDrivers.length || existingUsers.length) {
    return res.status(409).json({ error: "Username already taken" })
  }

  const hashed = await bcrypt.hash(password, 10)
  await pool.query(
    "INSERT INTO drivers (fullname, phone, truck_number, username, password, status) VALUES (?, ?, ?, ?, ?, 'available')",
    [fullname, phone, truck_number, username, hashed]
  )

  res.json({ success: true })
}))

// ===================== ERRORS / FALLBACK =====================

app.use((err, req, res, next) => {
  console.error(err)
  res.status(400).json({ error: err.message || "Request failed" })
})

const PORT = process.env.PORT || 3000

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Sanitation System backend running on port ${PORT}`)
    })
  })
  .catch((err) => {
    console.error("Failed to run startup migrations:", err)
    process.exit(1)
  })
