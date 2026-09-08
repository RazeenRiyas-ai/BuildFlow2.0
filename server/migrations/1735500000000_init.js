/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  pgm.sql(`CREATE TYPE user_role AS ENUM ('contractor', 'hq_staff', 'hq_admin');`);

  pgm.sql(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role user_role NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE contractors (
      id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      company_name TEXT,
      phone TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE hq_staff (
      id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE construction_sites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );
  `);
  pgm.sql(`CREATE INDEX construction_sites_contractor_idx ON construction_sites (contractor_id);`);

  pgm.sql(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_ios TEXT,
      icon_android TEXT,
      icon_web TEXT
    );
  `);

  pgm.sql(`
    CREATE TABLE suppliers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      locality TEXT NOT NULL,
      phone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE TYPE stock_status AS ENUM ('in_stock', 'limited_stock', 'out_of_stock');`);

  pgm.sql(`
    CREATE TABLE materials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id),
      supplier_id UUID NOT NULL REFERENCES suppliers(id),
      image_url TEXT,
      price_per_unit NUMERIC(10,2) NOT NULL,
      unit TEXT NOT NULL,
      stock_status stock_status NOT NULL DEFAULT 'in_stock',
      min_order_quantity NUMERIC(10,2) NOT NULL,
      quantity_step NUMERIC(10,2) NOT NULL,
      estimated_delivery_days TEXT NOT NULL,
      description TEXT,
      is_featured BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX materials_category_idx ON materials (category_id);`);

  pgm.sql(`CREATE TYPE order_status AS ENUM ('requested','confirmed','out_for_delivery','delivered','cancelled');`);

  pgm.sql(`
    CREATE TABLE orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contractor_id UUID NOT NULL REFERENCES contractors(id),
      site_id UUID NOT NULL REFERENCES construction_sites(id),
      site_label TEXT NOT NULL,
      site_address TEXT NOT NULL,
      status order_status NOT NULL DEFAULT 'requested',
      estimated_delivery_days TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX orders_contractor_created_idx ON orders (contractor_id, created_at DESC);`);
  pgm.sql(`CREATE INDEX orders_status_idx ON orders (status);`);

  pgm.sql(`
    CREATE TABLE order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      material_id UUID NOT NULL REFERENCES materials(id),
      material_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price_per_unit NUMERIC(10,2) NOT NULL,
      quantity NUMERIC(10,2) NOT NULL
    );
  `);
  pgm.sql(`CREATE INDEX order_items_order_idx ON order_items (order_id);`);

  pgm.sql(`CREATE TYPE coordination_type AS ENUM ('status_change','supplier_contact','delivery_update');`);

  pgm.sql(`
    CREATE TABLE order_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      type coordination_type NOT NULL,
      from_status order_status,
      to_status order_status,
      actor_user_id UUID REFERENCES users(id),
      supplier_id UUID REFERENCES suppliers(id),
      contact_method TEXT,
      outcome TEXT,
      delivery_date DATE,
      carrier_info TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX order_status_history_order_idx ON order_status_history (order_id);`);

  pgm.sql(`
    CREATE TABLE push_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expo_push_token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, expo_push_token)
    );
  `);
  pgm.sql(`CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);`);

  pgm.sql(`
    CREATE TABLE events (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      contractor_id UUID REFERENCES contractors(id),
      session_id TEXT,
      properties JSONB NOT NULL DEFAULT '{}',
      occurred_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX events_name_occurred_idx ON events (name, occurred_at);`);
  pgm.sql(`CREATE INDEX events_contractor_idx ON events (contractor_id);`);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS events;
    DROP TABLE IF EXISTS push_tokens;
    DROP TABLE IF EXISTS order_status_history;
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS materials;
    DROP TABLE IF EXISTS suppliers;
    DROP TABLE IF EXISTS categories;
    DROP TABLE IF EXISTS construction_sites;
    DROP TABLE IF EXISTS hq_staff;
    DROP TABLE IF EXISTS contractors;
    DROP TABLE IF EXISTS users;
    DROP TYPE IF EXISTS coordination_type;
    DROP TYPE IF EXISTS order_status;
    DROP TYPE IF EXISTS stock_status;
    DROP TYPE IF EXISTS user_role;
  `);
};
