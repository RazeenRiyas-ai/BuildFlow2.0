/**
 * Phase 3.5: HQ Supplier Management.
 *
 * Adds `is_active` to `suppliers`, mirroring the same flag added to `drivers` in Phase 3.4 and to
 * `materials` in Phase 3.1 — lets HQ retire a supplier from future contact/assignment without
 * deleting the row (which `materials.supplier_id` references with a NOT NULL FK, and which
 * `order_status_history.supplier_id`/`orders.assigned_supplier_id` may already reference from past
 * orders — deleting is never an option here).
 *
 * Unlike drivers, suppliers are never snapshotted onto an order (no supplier_name/supplier_phone
 * columns exist, or ever have) — assignSupplier/recordSupplierContact only ever store a live
 * assigned_supplier_id/supplier_id pointer, and the frontend resolves a supplier's name by
 * matching that id against the HQ-fetched supplier list, not from any stored snapshot. This
 * migration does not change that: it only adds a flag that (a) lets HQ's supplier list/picker
 * exclude inactive suppliers by default and (b) is checked at the point of a NEW
 * contact/assignment (see hq.service.ts), so a deactivated supplier can no longer be freshly
 * contacted or assigned. It has no effect on any existing order, any materials.supplier_id FK, or
 * the public GET /suppliers/:id lookup a contractor's material-detail page uses — none of those
 * filter on is_active.
 *
 * DEFAULT true means every existing supplier row is active immediately after this migration —
 * output of every existing caller (list, getById) is byte-for-byte unchanged until an operator
 * explicitly deactivates a supplier for the first time.
 */

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE suppliers DROP COLUMN IF EXISTS is_active;`);
};
