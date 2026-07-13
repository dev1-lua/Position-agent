import { StockRow, DnpRow } from './types';

/**
 * Derive an export's own report date from its rows — the desk mandate
 * (2026-07-10): the position date must ALWAYS be accurate, never silently
 * defaulted to "today". An old export uploaded without comment must land on
 * its true data date, so the staleness warning can do its job.
 *
 * Sources (validated against the real 2026-06-18 exports, unanimous):
 *  - XBS Current Stock: "Intake Date" + "Stock In Day(s)" = report date
 *    (754/754 derivable rows agree on the golden day).
 *  - SOL DailyNetPosition: "DatePos" column, DD-MM-YYYY (459/459 rows agree).
 *  - SOL ReportLogistic carries NO report date anywhere in its rows (checked
 *    column-by-column) — the trader/model must supply it; refusing to guess
 *    is the accurate behaviour.
 *
 * Majority vote across rows, so a handful of malformed rows can't flip the
 * date; `agree`/`total` let the caller warn when the vote isn't unanimous.
 */

export interface SniffedDate {
  /** YYYY-MM-DD, or null when no row yielded a date. */
  date: string | null;
  /** Rows voting for `date`. */
  agree: number;
  /** Rows that yielded any date. */
  total: number;
}

const DAY_MS = 86_400_000;

function majority(votes: Map<string, number>): SniffedDate {
  let date: string | null = null;
  let agree = 0;
  let total = 0;
  for (const [d, n] of votes) {
    total += n;
    if (n > agree) {
      agree = n;
      date = d;
    }
  }
  return { date, agree, total };
}

/** XBS Current Stock: report date = Intake Date + Stock In Day(s), row-majority. */
export function xbsReportDate(rows: StockRow[]): SniffedDate {
  const votes = new Map<string, number>();
  for (const r of rows) {
    if (!r.intakeDate || r.stockInDays == null || Number.isNaN(r.stockInDays)) continue;
    const d = new Date(r.intakeDate.getTime() + r.stockInDays * DAY_MS);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  return majority(votes);
}

/** Parse SOL's DD-MM-YYYY (also tolerates YYYY-MM-DD) into YYYY-MM-DD, or null. */
export function parseSolDate(v: string | undefined): string | null {
  const s = String(v ?? '').trim();
  let m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  return null;
}

/** SOL DailyNetPosition: report date = the DatePos column, row-majority. */
export function dnpReportDate(rows: DnpRow[]): SniffedDate {
  const votes = new Map<string, number>();
  for (const r of rows) {
    const d = parseSolDate(r.datePos);
    if (!d) continue;
    votes.set(d, (votes.get(d) ?? 0) + 1);
  }
  return majority(votes);
}

/** Today's date in Nairobi, YYYY-MM-DD — the desk clock for date sanity checks and defaults. */
export function nairobiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}

/**
 * Resolve the position date an ingest tool must store under. The export's own
 * date is authoritative; a conflicting trader/model-provided date produces a
 * warning but never wins — data cannot lie about its own day. A date past
 * `today` (Nairobi) is warned, not blocked: staleness math treats a future
 * snapshot as permanently current, so the trader must be told at upload time.
 */
export function resolvePositionDate(
  sniffed: SniffedDate,
  provided: string | undefined,
  exportLabel: string,
  today: string = nairobiToday()
): { positionDate: string; dateSource: string; warnings: string[] } {
  const warnings: string[] = [];
  const finish = (positionDate: string, dateSource: string) => {
    if (positionDate > today) {
      warnings.push(
        `${exportLabel}: report date ${positionDate} is in the FUTURE (today is ${today} in Nairobi) — check the file and the date; stored as-is, but the staleness banner can never flag a future-dated snapshot.`
      );
    }
    return { positionDate, dateSource, warnings };
  };
  if (sniffed.date) {
    if (sniffed.agree < sniffed.total) {
      warnings.push(
        `${exportLabel}: rows disagree on the report date — ${sniffed.agree}/${sniffed.total} say ${sniffed.date}; using the majority.`
      );
    }
    if (provided && provided !== sniffed.date) {
      warnings.push(
        `You said ${provided}, but the export's own rows say ${sniffed.date} — stored under ${sniffed.date} (the export's date always wins).`
      );
    }
    return finish(sniffed.date, `derived from the export's own rows (${sniffed.agree}/${sniffed.total} rows)`);
  }
  if (provided) {
    return finish(provided, 'trader-provided (no date derivable from the export rows)');
  }
  throw new Error(
    `${exportLabel} carries no derivable report date and none was provided — ask the trader which day this export is from and pass positionDate. Never assume it is today's.`
  );
}
