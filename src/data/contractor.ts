import { Contractor } from '@/types';

/** MVP has no authentication — this stands in for the signed-in contractor. */
export const MOCK_CONTRACTOR: Contractor = {
  id: 'contractor-1',
  name: 'Arjun Mehta',
  companyName: 'Mehta Constructions',
  phone: '+91 98765 43210',
};
