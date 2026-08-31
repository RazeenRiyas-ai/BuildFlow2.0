export interface ConstructionSite {
  id: string;
  label: string;
  address: string;
  notes?: string;
}

export interface NewConstructionSiteInput {
  label: string;
  address: string;
  notes?: string;
}
