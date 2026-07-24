# Sanitation Services and Tracking System

A small web app for requesting and tracking sanitation services (septic tank
and pit latrine emptying), with separate dashboards for customers, drivers,
and admins.

## Stack

- Node.js + Express backend (`backend/server.js`)
- MySQL for storage
- Plain HTML/CSS/JS frontend, served statically from `backend/public/`
- JWT-based auth, bcrypt password hashing
- Leaflet for the admin heatmap

## Running locally

1. Have a MySQL server running with a database created (see `backend/schema.sql` if present, or point `DB_NAME` at an existing one with `users`, `drivers`, and `requests` tables).
2. Copy the env file and fill in your local values:
   ```
   cd backend
   cp .env.example .env
   ```
3. Install dependencies and start the server:
   ```
   npm install
   npm start
   ```
4. Visit `http://localhost:3000/login.html`.

On first run, if no admin account exists, one is created automatically
(`admin` / `admin123`) — change this password after logging in.

## Roles

- **Customer** — registers via `register.html`, submits requests, tracks status/payment.
- **Driver** — created by an admin, sees assigned jobs, uploads proof-of-completion photos, marks payment received.
- **Admin** — assigns drivers, views all requests, the demand heatmap, and revenue stats.

## Environment variables

See `backend/.env.example`. `DB_*` variables also fall back to `MYSQL*`
(host/port/user/password/database) so this deploys as-is on platforms like
Railway that auto-inject those names for an attached MySQL plugin.
