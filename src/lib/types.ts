/** Shared domain types for the position engine. */

/** A blend recipe: fractions (0..1) of a client blend across POST grades. */
export interface Blend {
  blendNo: number;
  client: string | null;
  grade: string | null;
  cupProfile: string | null;
  /** grade → fraction of the blend (fractions sum to ~1 for defined blends). */
  recipe: Record<string, number>;
}

/** A forward sale (a short) parsed from the SOL logistics/sales report. */
export interface Sale {
  saleCtr: string | null;
  client: string | null;
  sGrade: string | null;
  cupProfile: string | null;
  sStrategy: string | null;
  /** Sale metric tons — negative (a commitment out). */
  smt: number;
  /** Sale bags — negative. */
  sbags?: number | null;
  /** Delivery month bucket, `YYYY/MM`. */
  month: string | null;
  /** Futures fixing month, e.g. `KCN/2026`. */
  sFixDte?: string | null;
  /** Blend number if already assigned (BASE FILE ground truth); otherwise resolved by the matcher. */
  blendNo?: number | null;
}

/** A raw stock lot parsed from the XBS stock report (stock-counter input). */
export interface StockRow {
  strategy: string; // Position Strategy Allocation, e.g. "PRE AA - FAQ", "POST 17 UP FAQ"
  warehouse?: string;
  intakeDate?: Date | null;
  batchId?: string;
  qty: number; // kg
  itemName?: string;
}

/** Outcome of resolving a sale to a blend. */
export interface BlendMatch {
  sale: Sale;
  blend: Blend | null;
  confidence: 'assigned' | 'high' | 'medium' | 'low' | 'none';
  reason: string;
  /** True when the trader should confirm before this sale is trusted. */
  needsConfirmation: boolean;
}

/** Forward-sales aggregation result (shorts). */
export interface ForwardSalesResult {
  /** grade → month(`YYYY/MM`) → bags (negative). */
  matrix: Record<string, Record<string, number>>;
  /** grade → total bags across all months (negative). */
  byGrade: Record<string, number>;
  /** Sorted list of month buckets present. */
  months: string[];
  /** Sales that could not be confidently matched to a blend. */
  pending: BlendMatch[];
  /** All match decisions (for auditing / accuracy checks). */
  matches: BlendMatch[];
}

/** Net position result. */
export interface NetPositionResult {
  /** grade → { theoretical (longs, +), forwardSales (shorts, −), net }. */
  byGrade: Record<string, { theoretical: number; forwardSales: number; net: number }>;
  total: { theoretical: number; forwardSales: number; net: number };
}
