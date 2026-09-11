/* eslint-disable */
exports.shorthands = undefined;

// Phase 3.3 — Multi-Item Orders.
//
// order_items has no natural ordering column: `id` is a random gen_random_uuid(), and every item
// belonging to one order is inserted inside the same transaction, so Postgres's own now() (stable
// per-transaction, not per-statement) can't be used to order them either. Without an explicit
// column, listing a multi-item order's items would return them in an arbitrary, potentially
// inconsistent order across requests. Mirrors the exact pattern material_photos.display_order
// already established in Phase 3.1 (see 1735550000000_material_photos_and_active_flag.js) — an
// application-assigned 0-based position, not a database-computed one.
//
// Additive and safe for existing data: every pre-existing order_items row (all single-item orders)
// defaults to 0, which is already correct for a one-item order (nothing to order relative to).
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE order_items ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE order_items DROP COLUMN IF EXISTS display_order;`);
};
