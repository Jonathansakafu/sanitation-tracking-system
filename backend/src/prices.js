// Server-side price list — the source of truth for request amounts.
// The client shows the same numbers for preview only; the server always
// recomputes from here so a tampered client can't submit an arbitrary amount.
const SERVICE_PRICES = {
  "Septic Tank": 50000,
  "Pit Latrine": 30000
}

module.exports = { SERVICE_PRICES }
