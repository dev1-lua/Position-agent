/**
 * Export-sniffing regression test — classifies the three real 2026-06-18 desk
 * exports (and synthetic variants) with lib/exportSniff, which drives the
 * spreadsheet-intake preprocessor's manifest.
 *
 * Run: `npx tsx src/__tests__/sniff.ts`
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { sniffExport, manifestText, ExportKind } from '../lib/exportSniff';

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../demo-files');

const cases: Array<[string, ExportKind]> = [
  ['XBS_Stock_2026-06-18.xlsx', 'xbs-stock'],
  ['DailyNetPosition_2026-06-18.xls', 'sol-dnp'],
  ['ReportLogistic_2026-06-18.xls', 'sol-logistics'],
];

let failed = 0;
const check = (label: string, kind: ExportKind, expected: ExportKind, extra = '') => {
  const ok = kind === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: kind=${kind} (expected ${expected})${extra}`);
};

for (const [file, expected] of cases) {
  const r = sniffExport(new Uint8Array(readFileSync(join(DEMO_DIR, file))));
  check(file, r.kind, expected, `, rows=${r.dataRows}`);
  console.log(`  manifest: ${manifestText('demo-file-id', r)}`);
}

// The REAL raw XBS export: comma-separated, but its header row embeds a
// literal tab ("Outturn / Factor\t,Warrant No") — this must NOT flip the
// delimiter detection to TSV (it did, in production, on 2026-07-10).
const realCsv = sniffExport(
  new Uint8Array(
    readFileSync(
      join(DEMO_DIR, '../forecast-context/XBS - Current Stock -ivo-2026-06-18 (2).csv')
    )
  )
);
check('real XBS CSV (tab embedded in header)', realCsv.kind, 'xbs-stock', `, rows=${realCsv.dataRows}`);
// 808 = python csv.reader census (§11); 8 raw lines are quoted-cell continuations.
if (realCsv.dataRows !== 808) {
  failed++;
  console.log(`FAIL real XBS CSV dataRows: ${realCsv.dataRows} (expected 808)`);
}

// The raw XBS export is a CSV (quoted cells) rather than an xlsx — synthesize
// one from the demo workbook to cover the text/csv path.
const wb = XLSX.read(new Uint8Array(readFileSync(join(DEMO_DIR, 'XBS_Stock_2026-06-18.xlsx'))), { type: 'array' });
const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
check('XBS as raw CSV', sniffExport(new TextEncoder().encode(csv)).kind, 'xbs-stock');

// A spreadsheet that is none of the three exports must classify as unknown.
const unknown = sniffExport(new TextEncoder().encode('Name,Age,City\nBob,4,Rome\n'));
check('generic CSV', unknown.kind, 'unknown');
console.log(`  manifest: ${manifestText('demo-file-id', unknown)}`);

// The manifest fileId must round-trip through resolveFileId's fallback regex.
const m = /\bfileId=([^;\s\]]+);/.exec(manifestText('abc-123.xyz', unknown));
const okRegex = m?.[1] === 'abc-123.xyz';
if (!okRegex) failed++;
console.log(`${okRegex ? 'PASS' : 'FAIL'} manifest fileId regex round-trip: got ${m?.[1]}`);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sniff checks passed');
