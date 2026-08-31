import { AppIcon } from '@/types/icon';

export type CategoryId =
  | 'cement'
  | 'steel'
  | 'sand'
  | 'bricks'
  | 'aggregates'
  | 'tiles'
  | 'plumbing'
  | 'electrical'
  | 'tools'
  | 'other';

export interface Category {
  id: CategoryId;
  name: string;
  icon: AppIcon;
}
