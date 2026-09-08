/* eslint-disable */
exports.shorthands = undefined;

// Safe only because orders and order_status_history are empty in every environment
// that has applied migrations so far. Replaces the payment-oriented state machine
// with the MVP's manual HQ-operational one, and removes payment columns entirely
// (payments are out of scope for this MVP). No down migration for the same reason
// enum recreation isn't reversed in the previous migration.
exports.up = (pgm) => {
  pgm.sql("ALTER TABLE order_status_history ALTER COLUMN from_status TYPE TEXT;");
  pgm.sql("ALTER TABLE order_status_history ALTER COLUMN to_status TYPE TEXT;");
  pgm.sql("ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;");
  pgm.sql("ALTER TABLE orders ALTER COLUMN status TYPE TEXT;");
  pgm.sql("DROP TYPE order_status;");
  pgm.sql("CREATE TYPE order_status AS ENUM ('requested','supplier_contacted','supplier_confirmed','supplier_rejected','driver_assigned','out_for_delivery','delivered','cancelled');");
  pgm.sql("ALTER TABLE orders ALTER COLUMN status TYPE order_status USING status::order_status;");
  pgm.sql("ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'requested'::order_status;");
  pgm.sql("ALTER TABLE order_status_history ALTER COLUMN from_status TYPE order_status USING from_status::order_status;");
  pgm.sql("ALTER TABLE order_status_history ALTER COLUMN to_status TYPE order_status USING to_status::order_status;");

  pgm.sql("ALTER TABLE orders DROP COLUMN payment_reference;");
  pgm.sql("ALTER TABLE orders DROP COLUMN payment_confirmed_at;");
};
