import type { OrderItem } from '@/types/order';
import { pluralizeUnit } from '@/types/unit';

/** A single item still names it directly (the pre-Phase-3.3, still-most-common case, and the
 * exact wording every list/queue row already used); more than one summarizes by count instead of
 * picking one material to show — used anywhere a full item list doesn't fit (order rows, HQ
 * queue rows). Order-detail screens render the full `items[]` themselves, never this summary. */
export function summarizeOrderItems(items: OrderItem[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) {
    const item = items[0];
    return `${item.quantity} ${pluralizeUnit(item.unit, item.quantity)} · ${item.materialName}`;
  }
  return `${items.length} items`;
}
