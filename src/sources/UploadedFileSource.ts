import { CDN } from 'lua-cli';
import * as XLSX from 'xlsx';
import { PositionSource } from './PositionSource';
import { StockRow, DnpRow, Sale } from '../lib/types';
import { decodeExportText, parseDailyNetPosition, parseLogisticsReport, aggregateSales } from '../lib/parse';

/**
 * PositionSource over files uploaded in chat: refs are CDN file ids. The XBS
 * stock report is a real .xlsx (SheetJS); the two SOL exports are TSV text
 * despite their .xls extension (see lib/parse.ts).
 */

/** XBS stock-report column headers (same aliases the browser stock counter used). */
const STOCK_HEADER_ALIASES: Record<keyof typeof STOCK_FIELDS, string[]> = {
  strategy: ['Position Strategy Allocation'],
  warehouse: ['Warehouse'],
  intakeDate: ['Intake Date'],
  batchId: ['Batch No.'],
  qty: ['Qty.'],
  itemName: ['Item Name'],
  blocked: ['Blocked'],
  itemPhase: ['Item Phase'],
  cropYear: ['Inventory Type'],
  certification: ['Certification'],
};
const STOCK_FIELDS = {
  strategy: 0, warehouse: 0, intakeDate: 0, batchId: 0, qty: 0, itemName: 0,
  blocked: 0, itemPhase: 0, cropYear: 0, certification: 0,
};

const INTAKE_MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Intake dates arrive as Date cells (xlsx) or "01-DEC-2024" strings (raw CSV). */
function parseIntakeDate(v: any): Date | null {
  if (v instanceof Date) return v;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const month = INTAKE_MONTHS[m[2].toUpperCase()];
  return month === undefined ? null : new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

/** Trimmed string, or undefined for empty/whitespace-only cells. */
const cell = (v: any): string | undefined => {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

/**
 * Parse an XBS Current Stock export into stock rows. Handles both the real
 * raw export (CSV, kg quantities, "01-DEC-2024" dates) and workbook variants
 * (e.g. the synthesized demo .xlsx) — columns are found by header name.
 */
export function parseXbsStock(data: ArrayBuffer | Uint8Array): StockRow[] {
  const workbook = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), {
    type: 'array',
    cellDates: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (grid.length < 2) return [];

  const headers = grid[0].map((h: any) => String(h ?? '').trim());
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(STOCK_HEADER_ALIASES)) {
    col[field] = headers.findIndex((h) => aliases.includes(h));
  }
  if (col.strategy === -1 || col.qty === -1) {
    throw new Error(
      `This does not look like an XBS stock report — missing "Position Strategy Allocation"/"Qty." columns (found: ${headers.slice(0, 8).join(', ')}…)`
    );
  }

  return grid.slice(1).map((row) => ({
    strategy: String(row[col.strategy] ?? ''),
    warehouse: row[col.warehouse] != null ? String(row[col.warehouse]) : undefined,
    intakeDate: parseIntakeDate(row[col.intakeDate]),
    batchId: row[col.batchId] != null ? String(row[col.batchId]) : undefined,
    qty: parseFloat(String(row[col.qty]).replace(/,/g, '')) || 0,
    itemName: row[col.itemName] != null ? String(row[col.itemName]) : undefined,
    blocked: String(row[col.blocked] ?? '').trim().toLowerCase() === 'yes',
    itemPhase: cell(row[col.itemPhase]),
    cropYear: cell(row[col.cropYear]),
    certification: cell(row[col.certification]),
  }));
}


export class UploadedFileSource implements PositionSource {
  private async fetchBytes(fileId: string): Promise<ArrayBuffer> {
    const file = await CDN.get(fileId);
    return file.arrayBuffer();
  }

  async getStock(fileId: string): Promise<StockRow[]> {
    return parseXbsStock(await this.fetchBytes(fileId));
  }

  async getDailyNetPosition(fileId: string): Promise<DnpRow[]> {
    return parseDailyNetPosition(decodeExportText(await this.fetchBytes(fileId)));
  }

  async getLogistics(fileId: string): Promise<Sale[]> {
    return aggregateSales(parseLogisticsReport(decodeExportText(await this.fetchBytes(fileId))));
  }
}
