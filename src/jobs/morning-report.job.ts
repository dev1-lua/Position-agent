import { LuaJob, User, env } from 'lua-cli';
import { round, bagsToMt } from '../lib/units';
import { getSnapshot } from '../skills/store';

/**
 * Morning position report — the Summary-style digest Ivo reads before the
 * trading day. Runs at 06:00 Nairobi, recomputes nothing: it reports the
 * latest computed snapshot and says loudly when that snapshot is stale
 * (no fresh upload) or incomplete (pending blends / missing manual inputs).
 *
 * Jobs have no ambient user — the recipient comes from job metadata
 * (`userId`, set after the trader first chats) or the MORNING_REPORT_USER_ID /
 * MORNING_REPORT_EMAIL env vars.
 */

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function formatMorningReport(d: any, todayISO: string): string {
  const lines: string[] = [];
  const stale = d.positionDate < todayISO;
  lines.push(`📊 Position Report — data as of ${d.positionDate}${stale ? ` (⚠️ STALE: no upload for ${todayISO} yet)` : ''}`);

  if (d.net?.total) {
    const t = d.net.total;
    lines.push('');
    lines.push(`Net position: ${fmt(t.net)} bags (${round(bagsToMt(t.net), 1)} MT)`);
    lines.push(`  Longs ${fmt(t.theoretical)} bags · Shorts ${fmt(t.forwardSales)} bags · Horizon ${d.net.horizon?.[0]}–${d.net.horizon?.[d.net.horizon.length - 1]}`);
  } else {
    lines.push('', '⚠️ Net position not computed for this snapshot.');
  }

  if (d.offers) {
    lines.push('', 'Offers (net, bags / MT):');
    for (const [group, v] of Object.entries<any>(d.offers)) {
      lines.push(`  ${group.padEnd(12)} ${fmt(v.bags).padStart(8)} / ${round(v.mt, 1)}`);
    }
  }

  if (d.net?.byGrade) {
    const shorts = Object.entries<any>(d.net.byGrade)
      .filter(([, v]) => v.net < 0)
      .sort((a, b) => a[1].net - b[1].net)
      .slice(0, 5);
    if (shorts.length) {
      lines.push('', 'Biggest short grades:');
      for (const [g, v] of shorts) lines.push(`  ${g}: ${fmt(v.net)} bags`);
    }
  }

  if (d.futs?.lines) {
    const l = d.futs.lines;
    const pick = (k: string) => (l[k]?.lots != null ? `${round(l[k].lots, 1)} lots` : 'n/a');
    lines.push('', `Hedge: stock hedgeable ${pick('Stock hedgeable')} · Kenyacof net ${pick('Kenyacof Net')} · Sucafina ${pick('Sucafina')} · true net excl. specialty ${pick('True_Net_Excl_Specialty')}`);
  }

  const pending = (d.pendingBlends ?? []).length;
  if (pending) lines.push('', `⚠️ ${pending} sale(s) still awaiting blend confirmation — shorts are understated until confirmed.`);
  const unresolved = (d.unresolvedForecastRows ?? []).length;
  if (unresolved) lines.push(`⚠️ ${unresolved} stock row(s) without yield percentages — longs are understated.`);

  return lines.join('\n');
}

export const morningReportJob = new LuaJob({
  name: 'morning-position-report',
  description: 'Sends the daily position digest (net, offers, biggest shorts, hedge view, staleness warnings) before the Nairobi trading day.',
  schedule: { type: 'cron', expression: '0 6 * * 1-5', timezone: 'Africa/Nairobi' },
  timeout: 120,
  retry: { maxAttempts: 2, backoffSeconds: 60 },
  metadata: {
    // Set to the trader's Lua userId to route the report; env vars are the fallback.
    userId: '',
  },
  execute: async (job) => {
    const snap = await getSnapshot();
    if (!snap) return { skipped: true, reason: 'No position snapshot exists yet.' };

    const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
    const report = formatMorningReport(snap.data, todayISO);

    const userId = (job.metadata?.userId as string) || env('MORNING_REPORT_USER_ID') || '';
    const email = env('MORNING_REPORT_EMAIL') || '';
    const user = userId ? await User.get(userId) : email ? await User.get({ email }) : null;
    if (!user) {
      return {
        sent: false,
        reason: 'No recipient configured — set job metadata userId or MORNING_REPORT_USER_ID / MORNING_REPORT_EMAIL env.',
        report,
      };
    }

    await user.send([{ type: 'text', text: report }]);
    return { sent: true, positionDate: snap.data.positionDate, stale: snap.data.positionDate < todayISO };
  },
});
