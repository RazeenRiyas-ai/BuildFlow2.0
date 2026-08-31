import { CATEGORIES } from '@/data/categories';
import { Category, CategoryId } from '@/types';

export async function getCategories(): Promise<Category[]> {
  return CATEGORIES;
}

export async function getCategoryById(categoryId: CategoryId): Promise<Category | undefined> {
  return CATEGORIES.find((category) => category.id === categoryId);
}
