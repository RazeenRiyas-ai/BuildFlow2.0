import { apiClient, ApiError } from '@/services/api-client';
import { CategoryId, Material } from '@/types';

export async function getMaterials(): Promise<Material[]> {
  return apiClient.get<Material[]>('/materials');
}

export async function getMaterialById(materialId: string): Promise<Material | undefined> {
  try {
    return await apiClient.get<Material>('/materials/' + materialId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return undefined;
    throw err;
  }
}

export async function getMaterialsByCategory(categoryId: CategoryId): Promise<Material[]> {
  return apiClient.get<Material[]>('/categories/' + categoryId + '/materials');
}

export async function searchMaterials(query: string): Promise<Material[]> {
  return apiClient.get<Material[]>('/materials/search?q=' + encodeURIComponent(query.trim()));
}

export async function getFeaturedMaterials(): Promise<Material[]> {
  return apiClient.get<Material[]>('/materials?featured=true');
}
