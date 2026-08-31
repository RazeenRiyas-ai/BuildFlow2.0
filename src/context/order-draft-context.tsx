import { createContext, PropsWithChildren, use, useMemo, useState } from 'react';

import { OrderDraft } from '@/types';

const EMPTY_DRAFT: OrderDraft = { materialId: null, quantity: 0, siteId: null };

interface OrderDraftContextValue {
  draft: OrderDraft;
  startDraft: (materialId: string, initialQuantity: number) => void;
  setQuantity: (quantity: number) => void;
  setSite: (siteId: string) => void;
  reset: () => void;
}

const OrderDraftContext = createContext<OrderDraftContextValue | null>(null);

/** The in-progress order selection (material → quantity → site) before it's submitted. Never persisted. */
export function OrderDraftProvider({ children }: PropsWithChildren) {
  const [draft, setDraft] = useState<OrderDraft>(EMPTY_DRAFT);

  const value = useMemo<OrderDraftContextValue>(
    () => ({
      draft,
      startDraft: (materialId, initialQuantity) =>
        setDraft({ materialId, quantity: initialQuantity, siteId: null }),
      setQuantity: (quantity) => setDraft((prev) => ({ ...prev, quantity })),
      setSite: (siteId) => setDraft((prev) => ({ ...prev, siteId })),
      reset: () => setDraft(EMPTY_DRAFT),
    }),
    [draft],
  );

  return <OrderDraftContext value={value}>{children}</OrderDraftContext>;
}

export function useOrderDraft() {
  const context = use(OrderDraftContext);
  if (!context) throw new Error('useOrderDraft must be used within an OrderDraftProvider');
  return context;
}
