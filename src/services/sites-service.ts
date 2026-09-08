import { apiClient } from '@/services/api-client';
import { ConstructionSite, NewConstructionSiteInput } from '@/types';

export async function getSites(): Promise<ConstructionSite[]> {
  return apiClient.get<ConstructionSite[]>('/sites');
}

export async function getSiteById(siteId: string): Promise<ConstructionSite | undefined> {
  const sites = await getSites();
  return sites.find((site) => site.id === siteId);
}

export async function addSite(input: NewConstructionSiteInput): Promise<ConstructionSite> {
  return apiClient.post<ConstructionSite>('/sites', input);
}
