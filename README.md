# Sanitation Services and Tracking System

A web application for requesting, dispatching, and tracking on-demand sanitation
services (septic tank and pit latrine emptying) in a multi-operator regulatory
model — residents submit requests, licensed operators (private waste-collection
companies) claim and fulfil them with their own drivers and trucks, and a
regulatory authority (EWURA) oversees operator licensing and service quality
across the network.

## Contents

- [Roles & workflow](#roles--workflow)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database](#database)
- [API reference](#api-reference)
- [Security model](#security-model)
- [Frontend pages](#frontend-pages)

## Roles & workflow

| Role | Landing page | Summary |
|---|---|---|
| **EWURA** (regulator/admin) | `ewura.html` | Registers and licenses operators, suspends/reinstates them, views the demand heatmap and system-wide/ward/operator statistics. `admin.html` remains available as a secondary "legacy tools" page for directly managing non-operator-affiliated drivers and requests. |
| **Operator** | `operator.html` | A licensed waste-collection company. Claims unclaimed requests and assigns them to its own drivers/trucks, manages its driver roster and truck fleet, approves or rejects drivers' cash-payment claims, and views its own revenue/demand analytics. |
| **Driver** | `driver.html` | Employed by an operator (or, for legacy accounts, by EWURA directly). Sees assigned jobs with resident contact info, notes, site photo and location, uploads a completion photo, and claims cash payments received. |
| **Resident** | `index.html` | Registers, submits service requests with location/photo/notes, tracks request progress through to payment, confirms completion, and leaves feedback. |

Request lifecycle: `pending` → **claimed** by an operator (driver + optional
truck assigned) → `driver_assigned` → driver uploads proof → `completed` →
resident (or operator, on the resident's behalf) confirms completion → for
cash payments, driver claims payment received → operator approves/rejects the
claim → `paid`. Online payments are marked paid automatically at confirmation.

## Architecture

- **Backend**: Node.js + Express, structured as small route modules under
  `backend/src/routes/` (`auth`, `requests`, `payments`, `operators`,
  `drivers`, `trucks`), mounted from a thin `backend/server.js`.
- **Auth**: JWT (`jsonwebtoken`), issued on login with `{ id, username, role }`
  and passed as `Authorization: Bearer <token>`. Every ownership check
  (an operator's own drivers/trucks/jobs, a driver's own jobs, a resident's
  own requests) is re-verified server-side against the token's `id` — request
  bodies are never trusted for authorization decisions.
- **Passwords**: bcrypt-hashed for all four roles. A startup migration
  (`src/migrate.js`) upgrades any legacy plaintext rows to bcrypt hashes.
- **Database**: MySQL via `mysql2/promise`, parameterized queries throughout.
  Schema is created and kept up to date automatically at boot
  (`CREATE TABLE IF NOT EXISTS` + idempotent `ALTER TABLE` column checks) —
  no manual migration step is required, including on a fresh/empty database.
- **File uploads**: `multer`, validated by size (5MB) and MIME type
  (`image/*`), stored on local disk under `backend/uploads/` and served
  statically at `/uploads/*`.
- **Frontend**: static HTML/CSS/vanilla JS served directly from
  `backend/public/` — no build step, no framework. Each page is
  self-contained; shared UI patterns (toast notifications, a promise-based
  confirm dialog, pagination, an image lightbox) are duplicated per page
  rather than bundled, matching the no-build-step approach.
- **Maps**: Leaflet + `leaflet.heat`, loaded from a CDN, used for the demand
  heatmap on the EWURA and operator dashboards.

## Project structure

```
backend/
  server.js              App entrypoint — middleware, route mounting, startup migration, listen
  src/
    auth.js               signToken / verifyToken / requireRole
    db.js                  mysql2 connection pool (env-configured)
    migrate.js              Idempotent schema creation + column backfills, run on every boot
    prices.js                Server-side authoritative service price list
    upload.js                 Shared multer config
    asyncRoute.js              Wraps async route handlers with a shared error handler
    routes/
      auth.js               POST /api/register, /api/login, PUT /api/users/change-password
      requests.js            Request CRUD + assignment + completion/confirmation lifecycle
      payments.js             Cash payment claim / approve / reject
      operators.js             Operator registration, listing, status, deletion
      drivers.js                Driver listing/creation (role-scoped)
      trucks.js                  Truck fleet CRUD (operator-scoped)
  public/                  Static frontend — see "Frontend pages" below
  uploads/                 User-uploaded site/proof photos (gitignored contents)
```

## Getting started

1. Have a MySQL server running and a database created:
   ```sql
   CREATE DATABASE sanitation_db;
   ```
2. Configure environment variables:
   ```
   cd backend
   cp .env.example .env
   # edit .env with your local DB credentials and a real JWT_SECRET
   ```
3. Install dependencies and start the server:
   ```
   npm install
   npm start
   ```
4. Visit `http://localhost:3000/login.html`.

On first boot, all tables are created automatically and, if no admin account
exists yet, one is seeded (`admin` / `admin123`) — log in and change this
password immediately via **Settings** on the EWURA dashboard.

## Environment variables

See `backend/.env.example`. `DB_*` variables fall back to Railway's
auto-injected `MYSQL*` names (`MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`,
`MYSQLPASSWORD`, `MYSQLDATABASE`), so the app deploys as-is against a Railway
MySQL plugin with no extra configuration.

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL connection |
| `JWT_SECRET` | Signing secret for auth tokens — use a long random string in production |
| `JWT_EXPIRES_IN` | Token lifetime (default `2d`) |

## Database

Six tables, all created and kept in sync automatically at startup:

- **`users`** — residents (`role='customer'`) and the admin/EWURA account (`role='admin'`); `fullname`, `phone`, `ward` for residents.
- **`operators`** — licensed companies; `business_name`, `ewura_license`, `status` (`active`/`suspended`).
- **`drivers`** — `operator_id` (nullable — `NULL` means a legacy, EWURA-managed driver).
- **`trucks`** — `operator_id`, `status` (`active`/`inactive`).
- **`requests`** — the single source of truth for jobs; carries `operator_id`, `driver_id`, `truck_id`, `status`, `paymentStatus`/`paymentMethod`, `confirmation_status`, `notes`, `site_image`/`proof_image`, `resident_comment`, `lat`/`lng`.

No separate migration tool or SQL files to run manually — `src/migrate.js`
diffs the live schema against what the code expects on every boot.

## API reference

All endpoints are prefixed `/api` and (except register/login) require
`Authorization: Bearer <token>`.

**Auth**
| Method | Path | Role |
|---|---|---|
| POST | `/register` | public (residents only) |
| POST | `/login` | public |
| PUT | `/users/change-password` | any authenticated user |

**Requests**
| Method | Path | Role |
|---|---|---|
| GET | `/requests` | any — server-side scoped per role |
| POST | `/requests` | resident |
| PUT | `/assign-driver/:id` | admin (by username) or operator (claim, by `driver_id`/`truck_id`) |
| POST | `/upload-proof/:id` | driver |
| PUT | `/requests/:id/confirm-completion` | resident |
| PUT | `/requests/:id/operator-confirm-completion` | operator |
| PUT | `/requests/:id/comment` | resident |
| DELETE | `/requests/:id` | admin |

**Payments**
| Method | Path | Role |
|---|---|---|
| PUT | `/payment/:id` | driver (claim) / admin (legacy direct mark-paid) |
| PUT | `/payment/:id/approve` | operator |
| PUT | `/payment/:id/reject` | operator |

**Operators / Drivers / Trucks**
| Method | Path | Role |
|---|---|---|
| POST | `/authority/register-operator` | admin |
| GET | `/operators` | admin |
| GET | `/operators/:id` | any authenticated |
| PUT | `/operators/:id/status` | admin |
| DELETE | `/operators/:id` | admin |
| GET / POST | `/drivers` | admin, operator (scoped) |
| POST / GET / PUT / DELETE | `/trucks[/:id[/status]]` | operator (scoped) |

## Security model

This system was rebuilt from an earlier prototype specifically to close a
class of authorization bugs where the client was trusted to say who it was
(e.g. `operator_id` sent in a request body). The current model:

1. Identity comes **only** from the verified JWT (`req.user.id`/`role`) — a
   client-supplied `operator_id`, `driver_id`, or `username` in a request body
   is never used for an authorization decision, only the token is.
2. Every scoped list/mutation endpoint re-derives its `WHERE` clause from
   `req.user.id` server-side (e.g. `GET /api/trucks` returns only the calling
   operator's own trucks, regardless of what a client might otherwise expect
   to request).
3. Service prices are computed server-side (`src/prices.js`) from the
   submitted `service` name — a client cannot submit an arbitrary `amount`.
4. Passwords are bcrypt-hashed for every role; a one-time migration upgrades
   any pre-existing plaintext rows automatically.

## Frontend pages

All under `backend/public/`, no build step required.

| Page | Purpose |
|---|---|
| `login.html` / `register.html` | Public entry points; register is resident-only (operators/drivers are provisioned by EWURA/operators respectively) |
| `index.html` | Resident dashboard |
| `request.html` | New service request form (resident) |
| `driver.html` | Driver dashboard |
| `operator.html` | Operator dashboard — job claiming, fleet/driver management, payment approvals, demand heatmap, revenue stats |
| `ewura.html` | EWURA (regulator) dashboard — operator licensing, demand heatmap, ward/operator statistics |
| `admin.html` | Secondary "legacy tools" page for direct (non-operator) driver/request management |
| `guide.html` | Step-by-step user guide, one section per role |
