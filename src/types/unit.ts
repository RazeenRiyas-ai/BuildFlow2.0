export type UnitOfMeasure = 'bag' | 'tonne' | 'kg' | 'piece' | 'sqft' | 'box' | 'unit' | 'litre';

export const UNIT_LABEL: Record<UnitOfMeasure, string> = {
  bag: 'bag',
  tonne: 'tonne',
  kg: 'kg',
  piece: 'piece',
  sqft: 'sq.ft',
  box: 'box',
  unit: 'unit',
  litre: 'litre',
};

export function pluralizeUnit(unit: UnitOfMeasure, quantity: number): string {
  const label = UNIT_LABEL[unit];
  if (quantity === 1 || unit === 'sqft') return label;
  return `${label}s`;
}
