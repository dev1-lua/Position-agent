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
  /** Flat sale price in `sPriceUnit`; 0/null = price-to-be-fixed (differential-only). */
  sPrice?: number | null;
  /** Unit of `sPrice`: 'USC/LB' | 'USD/KG' | 'USD/MT'. */
  sPriceUnit?: string | null;
  /** Contract differential vs the NY KC futures, USc/lb. */
  sDif?: number | null;
  /** FOB-equivalent differential, USc/lb (comparable across Incoterms). */
  sFobDif?: number | null;
  /** Sale Incoterm, e.g. FOB / CIF / DAP — explains sDif vs sFobDif gaps. */
  sTerm?: string | null;
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

/** A row of the SOL DailyNetPosition export (the columns the hedge maths uses). */
export interface DnpRow {
  quality: string;   // "Hedgeable" / "Non Hedgeable"
  state: string;     // e.g. "0-In Store Origin unsold"
  company: string;   // supplier/customer, e.g. "KENYACOF", "RABOBANK IN"
  pMt: number;       // P.MT (col O)
  sMt: number;       // S.MT (col P)
  totLine: number;   // TotLine (col S)
}

/** Net position result. */
export interface NetPositionResult {
  /** grade → { theoretical (longs, +), forwardSales (shorts, −), net }. */
  byGrade: Record<string, { theoretical: number; forwardSales: number; net: number }>;
  total: { theoretical: number; forwardSales: number; net: number };
}
