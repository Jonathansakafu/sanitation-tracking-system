require("dotenv").config()

const path = require("path")
const express = require("express")
const cors = require("cors")

const runMigrations = require("./src/migrate")
const { UPLOADS_DIR } = require("./src/upload")

const app = express()

app.use(cors())
app.use(express.json())

app.use("/uploads", express.static(UPLOADS_DIR))
app.use(express.static(path.join(__dirname, "public")))

app.use("/api", require("./src/routes/auth"))
app.use("/api", require("./src/routes/requests"))
app.use("/api", require("./src/routes/payments"))
app.use("/api", require("./src/routes/operators"))
app.use("/api", require("./src/routes/drivers"))
app.use("/api", require("./src/routes/trucks"))

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
