import { File } from 'expo-file-system';
import { apiClient } from '@/services/api-client';
import { HqMaterial, MaterialFormInput, MaterialPhoto } from '@/types';

export interface HqMaterialListFilters {
  q?: string;
  categoryId?: string;
  includeInactive?: boolean;
}

function buildQuery(filters: HqMaterialListFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.includeInactive) params.set('includeInactive', 'true');
  const query = params.toString();
  return query ? '?' + query : '';
}

export async function getHqMaterials(filters: HqMaterialListFilters = {}): Promise<HqMaterial[]> {
  return apiClient.get<HqMaterial[]>('/hq/materials' + buildQuery(filters));
}

export async function getHqMaterialById(materialId: string): Promise<HqMaterial> {
  return apiClient.get<HqMaterial>('/hq/materials/' + materialId);
}

export async function createHqMaterial(input: MaterialFormInput): Promise<HqMaterial> {
  return apiClient.post<HqMaterial>('/hq/materials', input);
}

export async function updateHqMaterial(materialId: string, patch: Partial<MaterialFormInput>): Promise<HqMaterial> {
  return apiClient.patch<HqMaterial>('/hq/materials/' + materialId, patch);
}

/** A picked-photo asset — `uri` is a local file:// (or content://) URI, never uploaded bytes held
 * in JS memory, which is what lets a large photo upload without ballooning app memory. */
export interface PickedPhotoAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

function toFormData(asset: PickedPhotoAsset, isPrimary?: boolean): FormData {
  const formData = new FormData();
  // Expo SDK 57's global fetch/FormData (expo/src/winter) is a from-scratch, web-standards
  // implementation — it does NOT understand the classic React Native `{uri, name, type}` file-part
  // shorthand (its own multipart converter only accepts a string, a real `Blob`, or an object with
  // a `bytes()` method — see node_modules/expo/src/winter/fetch/convertFormData.ts). expo-file-system's
  // `File` implements exactly that Blob-compatible interface (including `.bytes()` and a `.type`
  // inferred from the file extension), so it's what has to be appended here instead of a plain
  // `{uri, name, type}` object.
  const file = new File(asset.uri);
  formData.append('photo', file, asset.fileName ?? 'photo.jpg');
  if (isPrimary !== undefined) {
    formData.append('isPrimary', isPrimary ? 'true' : 'false');
  }
  return formData;
}

export async function listMaterialPhotos(materialId: string): Promise<MaterialPhoto[]> {
  return apiClient.get<MaterialPhoto[]>('/hq/materials/' + materialId + '/photos');
}

export async function uploadMaterialPhoto(materialId: string, asset: PickedPhotoAsset, isPrimary?: boolean): Promise<MaterialPhoto> {
  return apiClient.upload<MaterialPhoto>('/hq/materials/' + materialId + '/photos', toFormData(asset, isPrimary));
}

export async function replaceMaterialPhoto(materialId: string, photoId: string, asset: PickedPhotoAsset): Promise<MaterialPhoto> {
  return apiClient.upload<MaterialPhoto>('/hq/materials/' + materialId + '/photos/' + photoId, toFormData(asset), { method: 'PUT' });
}

export async function setPrimaryMaterialPhoto(materialId: string, photoId: string): Promise<MaterialPhoto> {
  return apiClient.post<MaterialPhoto>('/hq/materials/' + materialId + '/photos/' + photoId + '/primary');
}

export async function deleteMaterialPhoto(materialId: string, photoId: string): Promise<void> {
  await apiClient.delete<void>('/hq/materials/' + materialId + '/photos/' + photoId);
}

export async function reorderMaterialPhotos(materialId: string, photoIds: string[]): Promise<MaterialPhoto[]> {
  return apiClient.patch<MaterialPhoto[]>('/hq/materials/' + materialId + '/photos/order', { photoIds });
}
