import * as XLSX from 'xlsx';
import { decodeExportText, parseTsv, parseDailyNetPosition } from './parse';
import { parseXbsStock } from '../sources/UploadedFileSource';
import { xbsReportDate, dnpReportDate } from './reportdate';

/**
 * Sniff which desk export an uploaded spreadsheet is, from its bytes alone.
 * Runs at chat-intake time (before the model sees the message) so the intake
 * manifest can point the model at the right ingest tool. Detection uses the
 * same header signatures the real parsers key on:
 *  - XBS Current Stock: "Position Strategy Allocation" + "Qty." (xlsx or raw CSV)
 *  - SOL DailyNetPosition: "Quality" + "TotLine" (UTF-16LE TSV named .xls)
 *  - SOL ReportLogistic: "Sale Ctr." + "S.Ship." (ASCII TSV named .xls)
 */

export type ExportKind = 'xbs-stock' | 'sol-dnp' | 'sol-logistics' | 'unknown';

export interface SniffResult {
  kind: ExportKind;
  headers: string[];
  dataRows: number;
  sheetNames?: string[];
  /** The export's own report date (XBS/DNP only), YYYY-MM-DD; null when not derivable. */
  dataDate?: string | null;
}

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;
const isCfb = (b: Uint8Array) =>
  b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

function fromWorkbook(wb: XLSX.WorkBook): Omit<SniffResult, 'kind'> {
  const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    blankrows: false,
  });
  return {
    headers: (grid[0] ?? []).map((h: any) => String(h ?? '').trim()),
    dataRows: Math.max(grid.length - 1, 0),
    sheetNames: wb.SheetNames,
  };
}

export function sniffExport(data: ArrayBuffer | Uint8Array): SniffResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let meta: Omit<SniffResult, 'kind'>;
  if (isZip(bytes) || isCfb(bytes)) {
    // real workbook container (.xlsx / legacy binary .xls)
    meta = fromWorkbook(XLSX.read(bytes, { type: 'array' }));
  } else {
    // text export: SOL TSVs (possibly UTF-16LE) or the raw XBS CSV.
    // Pick the delimiter by COUNT, not presence: the real XBS CSV embeds a
    // stray tab inside one header cell ("Outturn / Factor\t,Warrant No"),
    // so "contains a tab" would misroute a 33-column CSV to the TSV parser.
    const text = decodeExportText(bytes);
    const firstLine = text.slice(0, (text + '\n').indexOf('\n'));
    const tabs = (firstLine.match(/\t/g) ?? []).length;
    const commas = (firstLine.match(/,/g) ?? []).length;
    if (tabs > commas) {
      const { header, rows } = parseTsv(text);
      meta = { headers: header, dataRows: rows.length };
    } else {
      // SheetJS handles quoted CSV correctly; naive splitting would not
      meta = fromWorkbook(XLSX.read(text, { type: 'string' }));
    }
  }

  const has = (name: string) => meta.headers.includes(name);
  let kind: ExportKind = 'unknown';
  if (has('Position Strategy Allocation') && has('Qty.')) kind = 'xbs-stock';
  else if (has('Quality') && has('TotLine')) kind = 'sol-dnp';
  else if (has('Sale Ctr.') && has('S.Ship.')) kind = 'sol-logistics';

  // Derive the export's own report date (via the same parsers ingestion uses)
  // so the manifest can pin the position date — the logistics export has no
  // internal date and must borrow it from its siblings or the trader.
  let dataDate: string | null = null;
  try {
    if (kind === 'xbs-stock') dataDate = xbsReportDate(parseXbsStock(bytes)).date;
    else if (kind === 'sol-dnp') dataDate = dnpReportDate(parseDailyNetPosition(decodeExportText(bytes))).date;
  } catch {
    dataDate = null; // date sniffing must never block intake
  }
  return { kind, dataDate, ...meta };
}

const KIND_INFO: Record<Exclude<ExportKind, 'unknown'>, { label: string; tool: string }> = {
  'xbs-stock': { label: 'XBS Current Stock export (longs input)', tool: 'ingest-stock-report' },
  'sol-dnp': { label: 'SOL DailyNetPosition export (hedge input)', tool: 'ingest-daily-net-position' },
  'sol-logistics': { label: 'SOL ReportLogistic export (forward sales / shorts input)', tool: 'ingest-logistics-report' },
};

/**
 * The text part that replaces the raw attachment. Format contract:
 * `fileId=<id>;` — resolveFileId() in skills/store.ts regex-scans chat history
 * for this exact shape as its fallback.
 */
export function manifestText(fileId: string, s: SniffResult): string {
  const shape = `${s.dataRows} data rows`;
  if (s.kind !== 'unknown') {
    const info = KIND_INFO[s.kind];
    const dateNote =
      s.kind === 'sol-logistics'
        ? 'This export carries NO internal date — pass positionDate explicitly (the data date of the XBS/DNP exports uploaded with it, or ask the trader for the report date; never guess today).'
        : s.dataDate
          ? `Data date ${s.dataDate} (derived from the export's own rows — the ingest tool stores under this date automatically).`
          : 'No data date derivable from the rows — pass positionDate after confirming the report date with the trader.';
    return (
      `[Spreadsheet received and stored: fileId=${fileId}; detected: ${info.label}, ${shape}. ` +
      `${dateNote} Call ${info.tool} with this fileId to ingest it into the position snapshot.]`
    );
  }
  const headers = s.headers.slice(0, 15).join(', ') + (s.headers.length > 15 ? ', …' : '');
  return (
    `[Spreadsheet received and stored: fileId=${fileId}; not recognized as one of the three desk exports ` +
    `(XBS stock / SOL DailyNetPosition / SOL ReportLogistic). ${shape}; headers: ${headers}. ` +
    `Ask the trader what this file is before ingesting anything.]`
  );
}
