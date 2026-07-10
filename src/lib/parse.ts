import { DnpRow, Sale, SaleBooking } from './types';

/**
 * Parsers for the SOL exports. Despite their `.xls` extension these are
 * tab-separated text files: DailyNetPosition is UTF-16LE, ReportLogistic is
 * ASCII with quoted headers/cells. The real XBS stock report is a genuine
 * .xlsx and is parsed with SheetJS at the source-adapter layer, not here.
 */

/** Decode an export's bytes, sniffing UTF-16LE (BOM or NUL density) vs 8-bit text. */
export function decodeExportText(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const utf16 =
    (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
    // no BOM: UTF-16LE ASCII text has a NUL in every other byte
    bytes.slice(0, Math.min(bytes.length, 512)).filter((b) => b === 0).length >
      Math.min(bytes.length, 512) / 4;
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes);
}

const stripQuotes = (s: string): string => {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

/** Parse TSV text into a header row and data rows (quotes stripped, blank lines dropped). */
export function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split('\t').map(stripQuotes);
  const rows = lines.slice(1).map((l) => l.split('\t').map(stripQuotes));
  return { header, rows };
}

const toNum = (s: string | undefined): number => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

const columnIndex = (header: string[], names: string[]): number => {
  for (const name of names) {
    const i = header.findIndex((h) => h.trim() === name);
    if (i !== -1) return i;
  }
  throw new Error(`Column not found: ${names.join(' / ')} (header: ${header.slice(0, 10).join(', ')}…)`);
};

/** Parse the DailyNetPosition export into the rows the Futs+Spread maths needs. */
export function parseDailyNetPosition(text: string): DnpRow[] {
  const { header, rows } = parseTsv(text);
  if (header.length === 0) return [];
  const col = {
    quality: columnIndex(header, ['Quality']),
    state: columnIndex(header, ['State']),
    company: columnIndex(header, ['Company']),
    pMt: columnIndex(header, ['P.MT']),
    sMt: columnIndex(header, ['S.MT']),
    totLine: columnIndex(header, ['TotLine']),
    certification: columnIndex(header, ['certification']),
  };
  return rows.map((r) => ({
    quality: r[col.quality] ?? '',
    state: r[col.state] ?? '',
    company: r[col.company] ?? '',
    pMt: toNum(r[col.pMt]),
    sMt: toNum(r[col.sMt]),
    totLine: toNum(r[col.totLine]),
    certification: r[col.certification] ?? '',
  }));
}

/**
 * Parse the ReportLogistic export into forward sales. Delivery month is
 * `LEFT(S.Ship., 7)` → `YYYY/MM`, matching the BASE FILE. Only rows whose
 * Status is in `statuses` are kept (default: unallocated sales — the shorts).
 */
export function parseLogisticsReport(
  text: string,
  statuses: string[] = ['6-Sales Unallocated']
): Sale[] {
  const { header, rows } = parseTsv(text);
  if (header.length === 0) return [];
  const col = {
    status: columnIndex(header, ['Status']),
    saleCtr: columnIndex(header, ['Sale Ctr.']),
    client: columnIndex(header, ['Client']),
    sGrade: columnIndex(header, ['S.Grade']),
    cupProfile: columnIndex(header, ['S.Cup Profile']),
    sStrategy: columnIndex(header, ['S.strategy']),
    smt: columnIndex(header, ['SMT']),
    sbags: columnIndex(header, ['S.bags']),
    ship: columnIndex(header, ['S.Ship.']),
    sFixDte: columnIndex(header, ['sFixDte']),
    sPrice: columnIndex(header, ['S. Price']),
    sPriceUnit: columnIndex(header, ['S. Unit']),
    sDif: columnIndex(header, ['S.Dif']),
    sFobDif: columnIndex(header, ['S.Fob dif']),
    sTerm: columnIndex(header, ['S.Term']),
    sCity: columnIndex(header, ['S.City']),
    sCountry: columnIndex(header, ['S.CodCountry']),
    paymentTerm: columnIndex(header, ['Payment term']),
    trader: columnIndex(header, ['Trader']),
    sCert: columnIndex(header, ['S.Cert']),
    // booking leg — the header repeats Vessel/ETD/ETA/POD/TransType for the
    // second transport leg (empty on this export); columnIndex takes the FIRST
    preshipId: columnIndex(header, ['PreshipID']),
    bookingLine: columnIndex(header, ['Booking Line']),
    vessel: columnIndex(header, ['Vessel']),
    voyage: columnIndex(header, ['Voy.Num']),
    bookingNum: columnIndex(header, ['Booking num.']),
    transType: columnIndex(header, ['TransType']),
    pol: columnIndex(header, ['POL']),
    pod: columnIndex(header, ['POD']),
    etd: columnIndex(header, ['ETD']),
    eta: columnIndex(header, ['ETA']),
    siDate: columnIndex(header, ['SI.Date']),
  };
  // booking fields use '0' as their empty marker
  const bookingVal = (r: string[], i: number): string | null => {
    const v = (r[i] ?? '').trim();
    return v === '' || v === '0' ? null : v;
  };
  const wanted = new Set(statuses);
  const sales: Sale[] = [];
  for (const r of rows) {
    if (!wanted.has(r[col.status] ?? '')) continue;
    const ship = (r[col.ship] ?? '').trim();
    sales.push({
      saleCtr: r[col.saleCtr] || null,
      client: r[col.client] || null,
      sGrade: r[col.sGrade] || null,
      cupProfile: r[col.cupProfile] || null,
      sStrategy: r[col.sStrategy] || null,
      smt: toNum(r[col.smt]),
      sbags: r[col.sbags] ? toNum(r[col.sbags]) : null,
      month: ship ? ship.substring(0, 7) : null,
      sFixDte: r[col.sFixDte] || null,
      blendNo: null,
      sPrice: toNum(r[col.sPrice]),
      sPriceUnit: r[col.sPriceUnit] || null,
      sDif: r[col.sDif]?.trim() ? toNum(r[col.sDif]) : null,
      sFobDif: r[col.sFobDif]?.trim() ? toNum(r[col.sFobDif]) : null,
      sTerm: r[col.sTerm] || null,
      sCity: r[col.sCity] || null,
      sCountry: r[col.sCountry] || null,
      paymentTerm: r[col.paymentTerm] || null,
      trader: r[col.trader] || null,
      sCert: r[col.sCert] || null,
      booking: ((): SaleBooking | null => {
        const b: SaleBooking = {
          preshipId: bookingVal(r, col.preshipId),
          line: bookingVal(r, col.bookingLine),
          vessel: bookingVal(r, col.vessel),
          voyage: bookingVal(r, col.voyage),
          bookingNum: bookingVal(r, col.bookingNum),
          transType: bookingVal(r, col.transType),
          pol: bookingVal(r, col.pol),
          pod: bookingVal(r, col.pod),
          etd: bookingVal(r, col.etd),
          eta: bookingVal(r, col.eta),
          siDate: bookingVal(r, col.siDate),
        };
        return Object.values(b).some((v) => v != null) ? b : null;
      })(),
    });
  }
  return sales;
}

/**
 * Merge logistics rows belonging to the same sale contract + delivery month
 * (a contract split across shipment lines), summing SMT and bags — the BASE
 * FILE carries one row per contract. Splits across different months are kept
 * apart so the forward-sales month buckets stay correct.
 */
export function aggregateSales(sales: Sale[]): Sale[] {
  // Price fields are SMT-weighted-averaged across split rows, each field over
  // the rows where it is present. Mixed price units across splits → unit null.
  type Acc = { sale: Sale; w: Record<string, number>; s: Record<string, number> };
  const PRICE_FIELDS = ['sPrice', 'sDif', 'sFobDif'] as const;
  const byKey = new Map<string, Acc>();
  for (const s of sales) {
    const key = `${s.saleCtr ?? ''}|${s.month ?? ''}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { sale: { ...s }, w: {}, s: {} };
      byKey.set(key, acc);
    } else {
      acc.sale.smt += s.smt;
      if (acc.sale.sbags != null || s.sbags != null) acc.sale.sbags = (acc.sale.sbags ?? 0) + (s.sbags ?? 0);
      const FLAT_STRINGS = ['sPriceUnit', 'sTerm', 'sCity', 'sCountry', 'paymentTerm', 'trader', 'sCert'] as const;
      for (const f of FLAT_STRINGS) if ((acc.sale[f] ?? null) !== (s[f] ?? null)) acc.sale[f] = null;
      // booking: a split contract can ride the same sailing on several
      // bookings (e.g. SSKE-103502: two preship IDs, one vessel) — join
      // differing IDs with ' / ', keep the earliest of differing dates
      if (!acc.sale.booking) acc.sale.booking = s.booking;
      else if (s.booking) {
        const DATE_FIELDS: (keyof SaleBooking)[] = ['etd', 'eta', 'siDate'];
        for (const k of Object.keys(acc.sale.booking) as (keyof SaleBooking)[]) {
          const a = acc.sale.booking[k];
          const b = s.booking[k];
          if (a === b || b == null) continue;
          if (a == null) acc.sale.booking[k] = b;
          else if (DATE_FIELDS.includes(k)) acc.sale.booking[k] = a < b ? a : b;
          else acc.sale.booking[k] = `${a} / ${b}`;
        }
      }
    }
    for (const f of PRICE_FIELDS) {
      const v = s[f];
      if (v == null) continue;
      acc.w[f] = (acc.w[f] ?? 0) + s.smt;
      acc.s[f] = (acc.s[f] ?? 0) + v * s.smt;
    }
  }
  return [...byKey.values()].map(({ sale, w, s }) => {
    for (const f of PRICE_FIELDS) sale[f] = w[f] ? s[f] / w[f] : null;
    return sale;
  });
}
