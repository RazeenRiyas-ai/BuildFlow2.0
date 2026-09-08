/* eslint-disable */
exports.shorthands = undefined;

// No down migration: reversing added enum values requires recreating the type in
// Postgres, and this runs before the orders table has any real data to preserve.
exports.up = (pgm) => {
  pgm.sql("ALTER TYPE order_status RENAME VALUE 'confirmed' TO 'awaiting_payment';");
  pgm.sql("ALTER TYPE order_status ADD VALUE 'payment_confirmed' AFTER 'awaiting_payment';");
  pgm.sql("ALTER TYPE coordination_type ADD VALUE 'supplier_assigned';");
  pgm.sql("ALTER TYPE coordination_type ADD VALUE 'driver_assigned';");

  pgm.sql("ALTER TABLE orders ADD COLUMN assigned_supplier_id UUID NULL REFERENCES suppliers(id);");
  pgm.sql("ALTER TABLE orders ADD COLUMN driver_name TEXT NULL;");
  pgm.sql("ALTER TABLE orders ADD COLUMN driver_phone TEXT NULL;");
  pgm.sql("ALTER TABLE orders ADD COLUMN contractor_note TEXT NULL;");
  pgm.sql("ALTER TABLE orders ADD COLUMN payment_reference TEXT NULL;");
  pgm.sql("ALTER TABLE orders ADD COLUMN payment_confirmed_at TIMESTAMPTZ NULL;");
};
