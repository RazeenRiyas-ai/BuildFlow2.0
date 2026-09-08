import { createContext, PropsWithChildren, use, useCallback, useMemo } from 'react';

import { useAuth } from '@/context/auth-context';
import { useAsyncData } from '@/hooks/use-async-data';
import { addSite as addSiteService, getSites } from '@/services/sites-service';
import { ConstructionSite, NewConstructionSiteInput } from '@/types';

interface SitesContextValue {
  sites: ConstructionSite[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  addSite: (input: NewConstructionSiteInput) => Promise<ConstructionSite>;
  getSiteById: (siteId: string) => ConstructionSite | undefined;
}

const SitesContext = createContext<SitesContextValue | null>(null);

/** Contractor's construction sites, fetched from the backend once authenticated. */
export function SitesProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const isContractor = user?.role === 'contractor';

  const fetchSites = useCallback(() => (isContractor ? getSites() : Promise.resolve([])), [isContractor]);
  const { data: sites, isLoading, error, refetch, setData: setSites } = useAsyncData<ConstructionSite[]>(fetchSites, []);

  const value = useMemo<SitesContextValue>(
    () => ({
      sites,
      isLoading,
      error,
      refetch,
      addSite: async (input) => {
        const newSite = await addSiteService(input);
        setSites((prev) => [...prev, newSite]);
        return newSite;
      },
      getSiteById: (siteId) => sites.find((site) => site.id === siteId),
    }),
    [sites, isLoading, error, refetch, setSites],
  );

  return <SitesContext value={value}>{children}</SitesContext>;
}

export function useSites() {
  const context = use(SitesContext);
  if (!context) throw new Error('useSites must be used within a SitesProvider');
  return context;
}
