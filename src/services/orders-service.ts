import { getMaterialById } from '@/services/materials-service';
import { readJson, writeJson } from '@/services/kv-store';
import { getSiteById } from '@/services/sites-service';
import { Order, SubmitOrderInput } from '@/types';

const STORAGE_KEY = 'buildflow.orders';

export async function getOrders(): Promise<Order[]> {
  return readJson<Order[]>(STORAGE_KEY, []);
}

export async function getOrderById(orderId: string): Promise<Order | undefined> {
  const orders = await getOrders();
  return orders.find((order) => order.id === orderId);
}

export async function submitOrder(input: SubmitOrderInput): Promise<Order> {
  const [material, site] = await Promise.all([getMaterialById(input.materialId), getSiteById(input.siteId)]);
  if (!material) throw new Error(`Unknown material: ${input.materialId}`);
  if (!site) throw new Error(`Unknown construction site: ${input.siteId}`);

  const newOrder: Order = {
    id: `order-${Date.now()}`,
    items: [
      {
        materialId: material.id,
        materialName: material.name,
        unit: material.unit,
        pricePerUnit: material.pricePerUnit,
        quantity: input.quantity,
      },
    ],
    siteId: site.id,
    siteLabel: site.label,
    siteAddress: site.address,
    status: 'requested',
    createdAt: new Date().toISOString(),
    estimatedDeliveryDays: material.estimatedDeliveryDays,
  };

  const orders = await getOrders();
  await writeJson(STORAGE_KEY, [newOrder, ...orders]);
  return newOrder;
}
