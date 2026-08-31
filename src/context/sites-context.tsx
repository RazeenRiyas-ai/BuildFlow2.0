import { createContext, PropsWithChildren, use, useEffect, useMemo, useState } from 'react';

import { addSite as addSiteService, getSites } from '@/services/sites-service';
import { ConstructionSite, NewConstructionSiteInput } from '@/types';

interface SitesContextValue {
  sites: ConstructionSite[];
  isLoading: boolean;
  addSite: (input: NewConstructionSiteInput) => Promise<ConstructionSite>;
  getSiteById: (siteId: string) => ConstructionSite | undefined;
}

const SitesContext = createContext<SitesContextValue | null>(null);

/** Contractor's construction sites, persisted on-device so they survive app restarts. */
export function SitesProvider({ children }: PropsWithChildren) {
  const [sites, setSites] = useState<ConstructionSite[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getSites()
      .then(setSites)
      .finally(() => setIsLoading(false));
  }, []);

  const value = useMemo<SitesContextValue>(
    () => ({
      sites,
      isLoading,
      addSite: async (input) => {
        const newSite = await addSiteService(input);
        setSites((prev) => [...prev, newSite]);
        return newSite;
      },
      getSiteById: (siteId) => sites.find((site) => site.id === siteId),
    }),
    [sites, isLoading],
  );

  return <SitesContext value={value}>{children}</SitesContext>;
}

export function useSites() {
  const context = use(SitesContext);
  if (!context) throw new Error('useSites must be used within a SitesProvider');
  return context;
}
