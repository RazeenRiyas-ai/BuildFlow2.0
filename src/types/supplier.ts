export interface Supplier {
  id: string;
  name: string;
  locality: string;
  phone?: string;
  /** Only ever present when fetched via the HQ-only list/create/update endpoints — the public
   * GET /suppliers/:id lookup a contractor's material-detail page uses never returns this. */
  isActive?: boolean;
}

export interface CreateSupplierInput {
  name: string;
  locality: string;
  phone?: string;
}

export interface UpdateSupplierInput {
  name?: string;
  locality?: string;
  phone?: string | null;
  isActive?: boolean;
}
