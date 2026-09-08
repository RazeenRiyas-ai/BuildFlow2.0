import { apiClient, ApiError } from '@/services/api-client';
import { Category, CategoryId } from '@/types';

export async function getCategories(): Promise<Category[]> {
  return apiClient.get<Category[]>('/categories');
}

export async function getCategoryById(categoryId: CategoryId): Promise<Category | undefined> {
  try {
    return await apiClient.get<Category>('/categories/' + categoryId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}
