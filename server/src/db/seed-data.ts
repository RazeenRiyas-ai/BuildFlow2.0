// Ported verbatim from the Expo app's mock data (src/data/*.ts) so local/dev backend
// data matches what the frontend previously showed. Development/test seeding only —
// never run against a production database.

export const CATEGORIES = [
  { id: 'cement', name: 'Cement', iconIos: 'shippingbox.fill', iconAndroid: 'inventory_2', iconWeb: 'inventory_2' },
  {
    id: 'steel',
    name: 'Steel',
    iconIos: 'square.stack.3d.up.fill',
    iconAndroid: 'view_in_ar',
    iconWeb: 'view_in_ar',
  },
  { id: 'sand', name: 'Sand', iconIos: 'circle.grid.3x3.fill', iconAndroid: 'grain', iconWeb: 'grain' },
  { id: 'bricks', name: 'Bricks', iconIos: 'cube.fill', iconAndroid: 'view_module', iconWeb: 'view_module' },
  {
    id: 'aggregates',
    name: 'Aggregates',
    iconIos: 'circle.hexagongrid.fill',
    iconAndroid: 'scatter_plot',
    iconWeb: 'scatter_plot',
  },
  { id: 'tiles', name: 'Tiles', iconIos: 'square.grid.3x3.fill', iconAndroid: 'grid_view', iconWeb: 'grid_view' },
  { id: 'plumbing', name: 'Plumbing', iconIos: 'drop.fill', iconAndroid: 'plumbing', iconWeb: 'plumbing' },
  {
    id: 'electrical',
    name: 'Electrical',
    iconIos: 'bolt.fill',
    iconAndroid: 'electrical_services',
    iconWeb: 'electrical_services',
  },
  {
    id: 'tools',
    name: 'Tools',
    iconIos: 'wrench.and.screwdriver.fill',
    iconAndroid: 'construction',
    iconWeb: 'construction',
  },
  { id: 'other', name: 'Other', iconIos: 'square.grid.2x2.fill', iconAndroid: 'category', iconWeb: 'category' },
] as const;

export const SUPPLIERS = [
  { key: 'sup-1', name: 'Shree Balaji Building Materials', locality: 'Pune' },
  { key: 'sup-2', name: 'Om Sai Traders', locality: 'Hyderabad' },
  { key: 'sup-3', name: 'Krishna Construction Supplies', locality: 'Bengaluru' },
  { key: 'sup-4', name: 'New Bharat Hardware & Cement Store', locality: 'Ahmedabad' },
  { key: 'sup-5', name: 'Ganesh Steel & Sand Depot', locality: 'Chennai' },
  { key: 'sup-6', name: 'Patel Tiles & Sanitaryware', locality: 'Surat' },
] as const;

export const FEATURED_MATERIAL_KEYS = ['mat-cement-1', 'mat-steel-1', 'mat-sand-2', 'mat-bricks-1', 'mat-tiles-2', 'mat-agg-1'];

export const MATERIALS = [
  // Cement
  { key: 'mat-cement-1', name: 'OPC 43 Grade Cement', categoryId: 'cement', supplierKey: 'sup-1', pricePerUnit: 380, unit: 'bag', stockStatus: 'in_stock', minOrderQuantity: 10, quantityStep: 5, estimatedDeliveryDays: '1-2 days', description: '50kg bag, general-purpose ordinary portland cement for RCC and plastering work.' },
  { key: 'mat-cement-2', name: 'OPC 53 Grade Cement', categoryId: 'cement', supplierKey: 'sup-1', pricePerUnit: 410, unit: 'bag', stockStatus: 'in_stock', minOrderQuantity: 10, quantityStep: 5, estimatedDeliveryDays: '1-2 days', description: '50kg bag, higher early strength — suited for structural and precast work.' },
  { key: 'mat-cement-3', name: 'PPC Cement', categoryId: 'cement', supplierKey: 'sup-4', pricePerUnit: 365, unit: 'bag', stockStatus: 'limited_stock', minOrderQuantity: 10, quantityStep: 5, estimatedDeliveryDays: '2-3 days', description: '50kg bag, portland pozzolana cement — better durability for mass concrete.' },
  { key: 'mat-cement-4', name: 'White Cement', categoryId: 'cement', supplierKey: 'sup-4', pricePerUnit: 950, unit: 'bag', stockStatus: 'in_stock', minOrderQuantity: 2, quantityStep: 1, estimatedDeliveryDays: '2-3 days', description: 'For finishing, putty base coats, and decorative work.' },

  // Steel
  { key: 'mat-steel-1', name: 'TMT Steel Bar Fe500 (8mm)', categoryId: 'steel', supplierKey: 'sup-5', pricePerUnit: 62, unit: 'kg', stockStatus: 'in_stock', minOrderQuantity: 50, quantityStep: 10, estimatedDeliveryDays: '2-3 days', description: 'High-strength deformed rebar for RCC columns, beams, and slabs.' },
  { key: 'mat-steel-2', name: 'TMT Steel Bar Fe500 (12mm)', categoryId: 'steel', supplierKey: 'sup-5', pricePerUnit: 60, unit: 'kg', stockStatus: 'in_stock', minOrderQuantity: 50, quantityStep: 10, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-steel-3', name: 'Mild Steel Angle', categoryId: 'steel', supplierKey: 'sup-5', pricePerUnit: 58, unit: 'kg', stockStatus: 'limited_stock', minOrderQuantity: 50, quantityStep: 10, estimatedDeliveryDays: '3-4 days', description: 'For structural framing, gates, and fabrication work.' },
  { key: 'mat-steel-4', name: 'Steel Binding Wire', categoryId: 'steel', supplierKey: 'sup-5', pricePerUnit: 68, unit: 'kg', stockStatus: 'in_stock', minOrderQuantity: 10, quantityStep: 5, estimatedDeliveryDays: '1-2 days' },

  // Sand
  { key: 'mat-sand-1', name: 'River Sand (Fine)', categoryId: 'sand', supplierKey: 'sup-5', pricePerUnit: 1450, unit: 'tonne', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-4 days', description: 'Washed river sand for plastering and masonry work.' },
  { key: 'mat-sand-2', name: 'M-Sand (Manufactured Sand)', categoryId: 'sand', supplierKey: 'sup-2', pricePerUnit: 1200, unit: 'tonne', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-3 days', description: 'Crushed-rock alternative to river sand, consistent grading.' },
  { key: 'mat-sand-3', name: 'Plastering Sand', categoryId: 'sand', supplierKey: 'sup-2', pricePerUnit: 1350, unit: 'tonne', stockStatus: 'out_of_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '3-5 days' },

  // Bricks
  { key: 'mat-bricks-1', name: 'Red Clay Bricks (Standard)', categoryId: 'bricks', supplierKey: 'sup-3', pricePerUnit: 8, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 500, quantityStep: 100, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-bricks-2', name: 'Fly Ash Bricks', categoryId: 'bricks', supplierKey: 'sup-3', pricePerUnit: 6.5, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 500, quantityStep: 100, estimatedDeliveryDays: '2-3 days', description: 'Lighter and more uniform than clay bricks, good insulation.' },
  { key: 'mat-bricks-3', name: 'AAC Blocks (Autoclaved)', categoryId: 'bricks', supplierKey: 'sup-3', pricePerUnit: 55, unit: 'piece', stockStatus: 'limited_stock', minOrderQuantity: 50, quantityStep: 10, estimatedDeliveryDays: '3-4 days', description: 'Lightweight aerated blocks — faster wall construction, good thermal insulation.' },
  { key: 'mat-bricks-4', name: 'Wire-Cut Bricks', categoryId: 'bricks', supplierKey: 'sup-3', pricePerUnit: 9.5, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 500, quantityStep: 100, estimatedDeliveryDays: '2-3 days' },

  // Aggregates
  { key: 'mat-agg-1', name: '20mm Coarse Aggregate', categoryId: 'aggregates', supplierKey: 'sup-5', pricePerUnit: 1100, unit: 'tonne', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-4 days', description: 'For RCC concrete mixes and road base work.' },
  { key: 'mat-agg-2', name: '10mm Coarse Aggregate', categoryId: 'aggregates', supplierKey: 'sup-5', pricePerUnit: 1150, unit: 'tonne', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-4 days' },
  { key: 'mat-agg-3', name: 'Crushed Stone Aggregate', categoryId: 'aggregates', supplierKey: 'sup-2', pricePerUnit: 950, unit: 'tonne', stockStatus: 'limited_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '3-5 days' },

  // Tiles
  { key: 'mat-tiles-1', name: 'Ceramic Floor Tiles (2x2 ft)', categoryId: 'tiles', supplierKey: 'sup-6', pricePerUnit: 42, unit: 'sqft', stockStatus: 'in_stock', minOrderQuantity: 100, quantityStep: 10, estimatedDeliveryDays: '3-5 days' },
  { key: 'mat-tiles-2', name: 'Vitrified Tiles (Glossy)', categoryId: 'tiles', supplierKey: 'sup-6', pricePerUnit: 65, unit: 'sqft', stockStatus: 'in_stock', minOrderQuantity: 100, quantityStep: 10, estimatedDeliveryDays: '3-5 days', description: 'High-gloss finish, low porosity — for living areas and flooring.' },
  { key: 'mat-tiles-3', name: 'Anti-Skid Bathroom Tiles', categoryId: 'tiles', supplierKey: 'sup-6', pricePerUnit: 58, unit: 'sqft', stockStatus: 'in_stock', minOrderQuantity: 50, quantityStep: 10, estimatedDeliveryDays: '3-5 days' },
  { key: 'mat-tiles-4', name: 'Wall Tiles (Kitchen/Bath)', categoryId: 'tiles', supplierKey: 'sup-6', pricePerUnit: 38, unit: 'sqft', stockStatus: 'limited_stock', minOrderQuantity: 50, quantityStep: 10, estimatedDeliveryDays: '4-6 days' },

  // Plumbing
  { key: 'mat-plumb-1', name: 'PVC Pipe 4 inch (10ft length)', categoryId: 'plumbing', supplierKey: 'sup-4', pricePerUnit: 420, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 5, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-plumb-2', name: 'CPVC Pipe 1 inch (10ft length)', categoryId: 'plumbing', supplierKey: 'sup-4', pricePerUnit: 210, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 5, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-plumb-3', name: 'Bathroom Faucet (Chrome)', categoryId: 'plumbing', supplierKey: 'sup-6', pricePerUnit: 850, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '3-4 days' },
  { key: 'mat-plumb-4', name: 'PVC Elbow Joint 4 inch', categoryId: 'plumbing', supplierKey: 'sup-4', pricePerUnit: 45, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 10, quantityStep: 5, estimatedDeliveryDays: '2-3 days' },

  // Electrical
  { key: 'mat-elec-1', name: 'Copper Wire 2.5mm (90m coil)', categoryId: 'electrical', supplierKey: 'sup-2', pricePerUnit: 2450, unit: 'box', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-elec-2', name: 'Modular Switch (6A)', categoryId: 'electrical', supplierKey: 'sup-2', pricePerUnit: 95, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 5, quantityStep: 5, estimatedDeliveryDays: '1-2 days' },
  { key: 'mat-elec-3', name: 'MCB Circuit Breaker (32A)', categoryId: 'electrical', supplierKey: 'sup-2', pricePerUnit: 210, unit: 'piece', stockStatus: 'limited_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-elec-4', name: 'LED Panel Light (18W)', categoryId: 'electrical', supplierKey: 'sup-2', pricePerUnit: 320, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },

  // Tools
  { key: 'mat-tools-1', name: 'Claw Hammer', categoryId: 'tools', supplierKey: 'sup-3', pricePerUnit: 280, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '1-2 days' },
  { key: 'mat-tools-2', name: 'Spirit Level (24 inch)', categoryId: 'tools', supplierKey: 'sup-3', pricePerUnit: 450, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '1-2 days' },
  { key: 'mat-tools-3', name: 'Measuring Tape (5m)', categoryId: 'tools', supplierKey: 'sup-3', pricePerUnit: 180, unit: 'piece', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '1-2 days' },
  { key: 'mat-tools-4', name: 'Cordless Drill Machine', categoryId: 'tools', supplierKey: 'sup-3', pricePerUnit: 2800, unit: 'piece', stockStatus: 'limited_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '3-5 days' },

  // Other
  { key: 'mat-other-1', name: 'Waterproofing Compound (20kg)', categoryId: 'other', supplierKey: 'sup-1', pricePerUnit: 1350, unit: 'unit', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-other-2', name: 'Tarpaulin Sheet (20x15 ft)', categoryId: 'other', supplierKey: 'sup-1', pricePerUnit: 1200, unit: 'unit', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },
  { key: 'mat-other-3', name: 'Curing Compound (5L)', categoryId: 'other', supplierKey: 'sup-1', pricePerUnit: 680, unit: 'unit', stockStatus: 'in_stock', minOrderQuantity: 1, quantityStep: 1, estimatedDeliveryDays: '2-3 days' },
] as const;

export const SEED_CONTRACTOR = {
  name: 'Arjun Mehta',
  companyName: 'Mehta Constructions',
  phone: '+91 98765 43210',
  devPassword: 'password123',
};

export const SEED_CONTRACTOR_SITES = [
  { label: 'Sunrise Residency — Block C', address: 'Plot 14, Wagholi, Pune, Maharashtra 412207' },
  { label: 'Green Valley Villas', address: 'Survey No. 62, Sarjapur Road, Bengaluru, Karnataka 562125' },
] as const;

export const SEED_HQ_ADMIN = {
  name: 'HQ Admin',
  phone: '+91 90000 00001',
  devPassword: 'password123',
};
