import { Category } from '@/types';

export const CATEGORIES: Category[] = [
  { id: 'cement', name: 'Cement', icon: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' } },
  { id: 'steel', name: 'Steel', icon: { ios: 'square.stack.3d.up.fill', android: 'view_in_ar', web: 'view_in_ar' } },
  { id: 'sand', name: 'Sand', icon: { ios: 'circle.grid.3x3.fill', android: 'grain', web: 'grain' } },
  { id: 'bricks', name: 'Bricks', icon: { ios: 'cube.fill', android: 'view_module', web: 'view_module' } },
  {
    id: 'aggregates',
    name: 'Aggregates',
    icon: { ios: 'circle.hexagongrid.fill', android: 'scatter_plot', web: 'scatter_plot' },
  },
  { id: 'tiles', name: 'Tiles', icon: { ios: 'square.grid.3x3.fill', android: 'grid_view', web: 'grid_view' } },
  { id: 'plumbing', name: 'Plumbing', icon: { ios: 'drop.fill', android: 'plumbing', web: 'plumbing' } },
  {
    id: 'electrical',
    name: 'Electrical',
    icon: { ios: 'bolt.fill', android: 'electrical_services', web: 'electrical_services' },
  },
  {
    id: 'tools',
    name: 'Tools',
    icon: { ios: 'wrench.and.screwdriver.fill', android: 'construction', web: 'construction' },
  },
  { id: 'other', name: 'Other', icon: { ios: 'square.grid.2x2.fill', android: 'category', web: 'category' } },
];
