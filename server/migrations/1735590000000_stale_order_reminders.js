/**
 * Phase 3.6: Order Lifecycle Trust & Follow-Through.
 *
 * Adds `stale_reminder_sent_at` to `orders` — a database-backed dedup marker for the new
 * stuck-order escalation reminder (see server/src/modules/orders/orders.service.ts's
 * sendStaleOrderReminders). NULL for every existing order means nothing is retroactively
 * reminded; the reminder job's own claiming query treats a NULL exactly like "never reminded
 * since the last change," so this column's meaning is self-contained and needs no backfill.
 *
 * No new index is added: `orders_status_idx` (from the initial migration) already lets the
 * reminder job's `status IN ('requested', 'supplier_rejected')` filter narrow to a small subset
 * of rows before the `updated_at` check runs, which is sufficient at current and near-future
 * order volumes — adding a second, overlapping index here would be premature.
 */

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE orders ADD COLUMN stale_reminder_sent_at TIMESTAMPTZ NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE orders DROP COLUMN IF EXISTS stale_reminder_sent_at;`);
};
