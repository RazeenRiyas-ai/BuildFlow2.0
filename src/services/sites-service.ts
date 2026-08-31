import { readJson, writeJson } from '@/services/kv-store';
import { SEED_SITES } from '@/data/construction-sites';
import { ConstructionSite, NewConstructionSiteInput } from '@/types';

const STORAGE_KEY = 'buildflow.sites';

export async function getSites(): Promise<ConstructionSite[]> {
  return readJson<ConstructionSite[]>(STORAGE_KEY, SEED_SITES);
}

export async function getSiteById(siteId: string): Promise<ConstructionSite | undefined> {
  const sites = await getSites();
  return sites.find((site) => site.id === siteId);
}

export async function addSite(input: NewConstructionSiteInput): Promise<ConstructionSite> {
  const sites = await getSites();
  const newSite: ConstructionSite = { id: `site-${Date.now()}`, ...input };
  await writeJson(STORAGE_KEY, [...sites, newSite]);
  return newSite;
}
