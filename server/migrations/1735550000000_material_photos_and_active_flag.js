/* eslint-disable */
exports.shorthands = undefined;

// Phase 3.1 — Production-Grade Product & Photo Management.
//
// Two additions:
//  1. materials.is_active: soft activate/deactivate for HQ material management. Existing rows
//     default to true so every previously-seeded/ordered material stays visible/orderable exactly
//     as before this migration — this is additive, not a behavior change for existing data.
//  2. material_photos: metadata for photos stored on disk (see server/src/storage/photo-storage.ts)
//     — binary bytes are deliberately never stored in Postgres. Each row points at a file the
//     server wrote under UPLOADS_DIR, named by this row's own id, so the DB row and the file it
//     describes always share an unguessable, server-generated identifier — never a client-supplied
//     filename.
//
// Primary-photo invariant ("at most one primary photo per material") is enforced by a PARTIAL
// UNIQUE INDEX on (material_id) WHERE is_primary — not just application logic. This is what makes
// it safe under concurrent requests: two transactions racing to mark two different photos primary
// for the same material will have one of them fail at the database with a unique_violation
// (23505), which the existing generic errorHandler already translates into a 409 (see
// errorHandler.ts's isUniqueViolation branch) — no new error-handling code needed for the race
// itself, only for the ordinary "set a new primary" path (materials.service.ts unsets the old one
// first, inside a transaction, using SELECT ... FOR UPDATE on the material row to serialize
// concurrent primary-photo changes for the same material, mirroring orders.service.ts's existing
// transitionOrderStatus pattern).
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE materials ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;`);

  pgm.sql(`
    CREATE TABLE material_photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      original_filename TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      display_order INTEGER NOT NULL DEFAULT 0,
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // At most one primary photo per material — enforced by the database, not just application code.
  pgm.sql(`
    CREATE UNIQUE INDEX material_photos_one_primary_idx
      ON material_photos (material_id)
      WHERE is_primary;
  `);

  // Ordering/listing photos for a material is the only query shape this table serves.
  pgm.sql(`CREATE INDEX material_photos_material_order_idx ON material_photos (material_id, display_order, created_at);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS material_photos;`);
  pgm.sql(`ALTER TABLE materials DROP COLUMN IF EXISTS is_active;`);
};
