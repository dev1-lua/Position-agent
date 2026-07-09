import { Sale } from './types';
import { mtToBags, round } from './units';

/**
 * Client-exposure and shipment-status analytics over the shorts book.
 *
 * The daily ReportLogistic export is pre-filtered to unallocated sales, so
 * "shipment status" here means the BOOKING state of the forward book (which
 * contracts have a preshipment/vessel assigned), not voyage tracking of past
 * shipments. Fields absent from the export (B/L, containers, invoices,
 * warehouses, consignees) are not reported — the tool layer declines them.
 */

export interface ClientExposure {
  client: string;
  contracts: number;
  smt: number;
  bags: number;
  /** Share of the total book by |SMT|, percent. */
  sharePct: number;
  /** Delivery month → SMT. */
  byMonth: Record<string, number>;
  soldGrades: string[];
  destinations: string[];
  paymentTerms: string[];
  traders: string[];
}

export function computeClientExposure(sales: Sale[]): { total: { contracts: number; smt: number; bags: number }; clients: ClientExposure[] } {
  const byClient = new Map<string, Sale[]>();
  for (const s of sales) {
    const c = s.client?.trim() || 'UNKNOWN';
    (byClient.get(c) ?? byClient.set(c, []).get(c)!).push(s);
  }
  const totalSmt = sales.reduce((a, s) => a + s.smt, 0);
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x?.trim()))].sort();

  const clients = [...byClient.entries()]
    .map(([client, ss]): ClientExposure => {
      const smt = ss.reduce((a, s) => a + s.smt, 0);
      const byMonth: Record<string, number> = {};
      for (const s of ss) {
        const m = s.month ?? 'UNKNOWN';
        byMonth[m] = round((byMonth[m] ?? 0) + s.smt, 4);
      }
      return {
        client,
        contracts: ss.length,
        smt: round(smt, 4),
        bags: round(mtToBags(smt), 2),
        sharePct: totalSmt ? round((Math.abs(smt) / Math.abs(totalSmt)) * 100, 1) : 0,
        byMonth: Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))),
        soldGrades: uniq(ss.map((s) => s.sGrade)),
        destinations: uniq(ss.map((s) => s.sCountry)),
        paymentTerms: uniq(ss.map((s) => s.paymentTerm)),
        traders: uniq(ss.map((s) => s.trader)),
      };
    })
    .sort((a, b) => Math.abs(b.smt) - Math.abs(a.smt));

  return {
    total: { contracts: sales.length, smt: round(totalSmt, 4), bags: round(mtToBags(totalSmt), 2) },
    clients,
  };
}

export interface ShipmentDetail {
  saleCtr: string | null;
  client: string | null;
  month: string | null;
  smt: number;
  /** Booking stage: preshipment exists but no vessel yet, or vessel assigned. */
  stage: 'preshipment-only' | 'vessel-assigned';
  vessel: string | null;
  voyage: string | null;
  line: string | null;
  bookingNum: string | null;
  pol: string | null;
  pod: string | null;
  etd: string | null;
  eta: string | null;
}

export interface ShipmentStatus {
  overall: {
    booked: { contracts: number; smt: number };
    unbooked: { contracts: number; smt: number };
    vesselAssigned: { contracts: number; smt: number };
  };
  /** Delivery month → booked/unbooked contract counts + SMT. */
  byMonth: Record<string, { booked: number; bookedSmt: number; unbooked: number; unbookedSmt: number }>;
  /** Booked contracts, sorted by ETD (unknown ETDs last). */
  shipments: ShipmentDetail[];
}

const isBooked = (s: Sale): boolean => s.booking != null && s.booking.preshipId != null;

export function computeShipmentStatus(sales: Sale[]): ShipmentStatus {
  const sum = (ss: Sale[]) => round(ss.reduce((a, s) => a + s.smt, 0), 4);
  const booked = sales.filter(isBooked);
  const unbooked = sales.filter((s) => !isBooked(s));
  const vessel = sales.filter((s) => s.booking?.vessel != null);

  const byMonth: ShipmentStatus['byMonth'] = {};
  for (const s of sales) {
    const m = s.month ?? 'UNKNOWN';
    const row = (byMonth[m] ??= { booked: 0, bookedSmt: 0, unbooked: 0, unbookedSmt: 0 });
    if (isBooked(s)) {
      row.booked += 1;
      row.bookedSmt = round(row.bookedSmt + s.smt, 4);
    } else {
      row.unbooked += 1;
      row.unbookedSmt = round(row.unbookedSmt + s.smt, 4);
    }
  }

  const shipments = booked
    .map((s): ShipmentDetail => ({
      saleCtr: s.saleCtr,
      client: s.client,
      month: s.month,
      smt: round(s.smt, 4),
      stage: s.booking!.vessel != null ? 'vessel-assigned' : 'preshipment-only',
      vessel: s.booking!.vessel,
      voyage: s.booking!.voyage,
      line: s.booking!.line,
      bookingNum: s.booking!.bookingNum,
      pol: s.booking!.pol,
      pod: s.booking!.pod,
      etd: s.booking!.etd,
      eta: s.booking!.eta,
    }))
    .sort((a, b) => (a.etd ?? '9999').localeCompare(b.etd ?? '9999'));

  return {
    overall: {
      booked: { contracts: booked.length, smt: sum(booked) },
      unbooked: { contracts: unbooked.length, smt: sum(unbooked) },
      vesselAssigned: { contracts: vessel.length, smt: sum(vessel) },
    },
    byMonth: Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))),
    shipments,
  };
}
