/* eslint-disable */
exports.shorthands = undefined;

// Adds a manually-HQ-set delivery charge to orders. Deliberately NOT auto-calculated from
// distance/weight/etc — HQ types in a number, same operational-MVP philosophy as every other HQ
// action in this schema (supplier/driver assignment, delivery updates).
//
// orders.delivery_charge is nullable by design, not defaulted to 0: NULL means "not yet
// determined by HQ", 0.00 means "HQ explicitly set free delivery" — these are different facts and
// must stay distinguishable (see hq.service.ts's setDeliveryCharge and the contractor-facing UI,
// which renders "To be confirmed" only for NULL, never for 0).
//
// order_status_history.amount is the audit-trail counterpart — same NUMERIC(10,2) precision as
// order_items.price_per_unit, a real typed column rather than encoding the value into the
// free-text `note` column (every other purpose-specific fact on this table already gets its own
// column: contact_method, outcome, carrier_info — money should be no different, or a future
// reader would have to parse it back out of prose).
//
// No down migration for the enum addition — reversing it requires recreating the type in
// Postgres, which would risk any 'delivery_charge_set' rows already written by then. Same
// reasoning as 1735600000000_stale_reminder_history_type.js's own addition.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE orders ADD COLUMN delivery_charge NUMERIC(10,2) NULL;`);
  pgm.sql(`ALTER TABLE order_status_history ADD COLUMN amount NUMERIC(10,2) NULL;`);
  pgm.sql(`ALTER TYPE coordination_type ADD VALUE 'delivery_charge_set';`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE orders DROP COLUMN IF EXISTS delivery_charge;`);
  pgm.sql(`ALTER TABLE order_status_history DROP COLUMN IF EXISTS amount;`);
  // coordination_type's new value is intentionally left in place — see comment above.
};
