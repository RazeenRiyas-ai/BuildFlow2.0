// Development/test-only seed script. Populates categories, suppliers, materials, and a
// seed contractor + HQ admin for local dev continuity with the previous mock-data app.
// Never point this at a production database.
import bcrypt from 'bcryptjs';
import { pool } from '../config/db';
import {
  CATEGORIES,
  SUPPLIERS,
  MATERIALS,
  FEATURED_MATERIAL_KEYS,
  SEED_CONTRACTOR,
  SEED_CONTRACTOR_SITES,
  SEED_HQ_ADMIN,
} from './seed-data';

async function seedCategories() {
  for (const category of CATEGORIES) {
    await pool.query(
      `INSERT INTO categories (id, name, icon_ios, icon_android, icon_web)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [category.id, category.name, category.iconIos, category.iconAndroid, category.iconWeb],
    );
  }
  console.log(`Seeded ${CATEGORIES.length} categories`);
}

async function seedSuppliers(): Promise<Map<string, string>> {
  const keyToId = new Map<string, string>();
  for (const supplier of SUPPLIERS) {
    const existing = await pool.query<{ id: string }>('SELECT id FROM suppliers WHERE name = $1', [supplier.name]);
    if (existing.rows[0]) {
      keyToId.set(supplier.key, existing.rows[0].id);
      continue;
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO suppliers (name, locality) VALUES ($1, $2) RETURNING id`,
      [supplier.name, supplier.locality],
    );
    keyToId.set(supplier.key, inserted.rows[0].id);
  }
  console.log(`Seeded ${SUPPLIERS.length} suppliers`);
  return keyToId;
}

async function seedMaterials(supplierKeyToId: Map<string, string>) {
  const featured = new Set<string>(FEATURED_MATERIAL_KEYS);
  let count = 0;
  for (const material of MATERIALS) {
    const supplierId = supplierKeyToId.get(material.supplierKey);
    if (!supplierId) throw new Error(`Unknown supplier key: ${material.supplierKey}`);

    const existing = await pool.query('SELECT id FROM materials WHERE name = $1 AND category_id = $2', [
      material.name,
      material.categoryId,
    ]);
    if (existing.rowCount) continue;

    const description = 'description' in material ? material.description : null;

    await pool.query(
      `INSERT INTO materials
         (name, category_id, supplier_id, price_per_unit, unit, stock_status,
          min_order_quantity, quantity_step, estimated_delivery_days, description, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        material.name,
        material.categoryId,
        supplierId,
        material.pricePerUnit,
        material.unit,
        material.stockStatus,
        material.minOrderQuantity,
        material.quantityStep,
        material.estimatedDeliveryDays,
        description,
        featured.has(material.key),
      ],
    );
    count += 1;
  }
  console.log(`Seeded ${count} materials`);
}

async function seedContractorAndSites() {
  const existing = await pool.query<{ id: string }>('SELECT id FROM users WHERE phone = $1', [
    SEED_CONTRACTOR.phone,
  ]);
  let contractorId: string;

  if (existing.rows[0]) {
    contractorId = existing.rows[0].id;
    console.log('Seed contractor already exists, skipping user creation');
  } else {
    const passwordHash = await bcrypt.hash(SEED_CONTRACTOR.devPassword, 10);
    const userRow = await pool.query<{ id: string }>(
      `INSERT INTO users (role, phone, password_hash) VALUES ('contractor', $1, $2) RETURNING id`,
      [SEED_CONTRACTOR.phone, passwordHash],
    );
    contractorId = userRow.rows[0].id;
    await pool.query(`INSERT INTO contractors (id, name, company_name, phone) VALUES ($1, $2, $3, $4)`, [
      contractorId,
      SEED_CONTRACTOR.name,
      SEED_CONTRACTOR.companyName,
      SEED_CONTRACTOR.phone,
    ]);
    console.log(
      `Seeded contractor ${SEED_CONTRACTOR.name} (phone ${SEED_CONTRACTOR.phone}, password ${SEED_CONTRACTOR.devPassword})`,
    );
  }

  const existingSites = await pool.query('SELECT id FROM construction_sites WHERE contractor_id = $1', [
    contractorId,
  ]);
  if (existingSites.rowCount === 0) {
    for (const site of SEED_CONTRACTOR_SITES) {
      await pool.query(`INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3)`, [
        contractorId,
        site.label,
        site.address,
      ]);
    }
    console.log(`Seeded ${SEED_CONTRACTOR_SITES.length} sites for seed contractor`);
  }
}

async function seedHqAdmin() {
  const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [SEED_HQ_ADMIN.phone]);
  if (existing.rowCount) {
    console.log('Seed HQ admin already exists, skipping');
    return;
  }

  const passwordHash = await bcrypt.hash(SEED_HQ_ADMIN.devPassword, 10);
  const userRow = await pool.query<{ id: string }>(
    `INSERT INTO users (role, phone, password_hash) VALUES ('hq_admin', $1, $2) RETURNING id`,
    [SEED_HQ_ADMIN.phone, passwordHash],
  );
  await pool.query(`INSERT INTO hq_staff (id, name) VALUES ($1, $2)`, [userRow.rows[0].id, SEED_HQ_ADMIN.name]);
  console.log(`Seeded HQ admin ${SEED_HQ_ADMIN.name} (phone ${SEED_HQ_ADMIN.phone}, password ${SEED_HQ_ADMIN.devPassword})`);
}

async function main() {
  await seedCategories();
  const supplierKeyToId = await seedSuppliers();
  await seedMaterials(supplierKeyToId);
  await seedContractorAndSites();
  await seedHqAdmin();
  await pool.end();
  console.log('Seeding complete.');
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
