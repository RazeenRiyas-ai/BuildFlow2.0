/* eslint-disable */
exports.shorthands = undefined;

// Phase 3.4 — Driver Management.
//
// Mirrors `suppliers`' own minimal shape (id, name, locality/phone, created_at) — drivers are the
// same kind of thing: a named, contactable, HQ-managed reference entity picked from a list when
// coordinating a delivery, not a platform user or app account. `is_active` (not present on
// suppliers) lets HQ retire a driver without losing the historical record of past orders they
// delivered — see orders.assigned_driver_id below, which references drivers but never cascades a
// delete; drivers are deactivated, never deleted, for exactly that reason.
//
// orders.driver_name / orders.driver_phone (from the very first migration) are left completely
// unchanged: they remain the snapshot of who was assigned at the time, exactly like
// order_items.material_name/price_per_unit already snapshot a material at order time. This new
// assigned_driver_id column is purely an additional pointer to the canonical driver record for
// future reference (e.g. "all orders this driver has handled") — assigning a driver still writes
// the snapshot columns too, so every existing screen that reads driver_name/driver_phone keeps
// working unchanged, and pre-migration orders (assigned_driver_id NULL) display exactly as before.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE drivers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      phone TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX drivers_name_idx ON drivers (name);`);

  pgm.sql(`ALTER TABLE orders ADD COLUMN assigned_driver_id UUID NULL REFERENCES drivers(id);`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE orders DROP COLUMN IF EXISTS assigned_driver_id;`);
  pgm.sql(`DROP TABLE IF EXISTS drivers;`);
};
