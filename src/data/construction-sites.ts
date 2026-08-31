import { ConstructionSite } from '@/types';

/** Seeded into on-device storage the first time the app runs, so Sites is never empty. */
export const SEED_SITES: ConstructionSite[] = [
  {
    id: 'site-1',
    label: 'Sunrise Residency — Block C',
    address: 'Plot 14, Wagholi, Pune, Maharashtra 412207',
  },
  {
    id: 'site-2',
    label: 'Green Valley Villas',
    address: 'Survey No. 62, Sarjapur Road, Bengaluru, Karnataka 562125',
  },
];
