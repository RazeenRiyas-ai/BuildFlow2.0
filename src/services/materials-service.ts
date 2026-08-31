import { MATERIALS } from '@/data/materials';
import { CategoryId, Material } from '@/types';

export async function getMaterials(): Promise<Material[]> {
  return MATERIALS;
}

export async function getMaterialById(materialId: string): Promise<Material | undefined> {
  return MATERIALS.find((material) => material.id === materialId);
}

export async function getMaterialsByCategory(categoryId: CategoryId): Promise<Material[]> {
  return MATERIALS.filter((material) => material.categoryId === categoryId);
}

export async function searchMaterials(query: string): Promise<Material[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return MATERIALS;
  return MATERIALS.filter((material) => material.name.toLowerCase().includes(normalized));
}

export async function getMaterialsByIds(materialIds: string[]): Promise<Material[]> {
  const idSet = new Set(materialIds);
  return MATERIALS.filter((material) => idSet.has(material.id));
}
