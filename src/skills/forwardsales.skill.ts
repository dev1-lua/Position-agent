import { LuaSkill, LuaTool, Data } from 'lua-cli';
import { z } from 'zod';
import { citeLine } from '../lib/cite';
import { matchBlend, globallyAmbiguousKeys, assignmentKey } from '../lib/blends';
import { computeForwardSales } from '../lib/shorts';
import { Sale } from '../lib/types';
import { round } from '../lib/units';
import {
  COLLECTIONS,
  getSnapshot,
  saveSnapshot,
  loadBlendRecipes,
  loadAssignmentMemory,
  persistAssignment,
  reconcilePendingBlends,
} from './store';

/**
 * Shorts: allocate each unallocated sale to a blend recipe (learned-memory
 * matcher; ambiguous/new keys are human-gated), then aggregate into the
 * forward-sales matrix (POST grade × delivery month).
 */

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to the latest snapshot');

class AssignBlends implements LuaTool {
  name = 'assign-blends';
  description =
    'Match every ingested sale to a blend recipe from the learned assignment memory; flags new or ambiguous (client, grade, strategy) keys for trader confirmation.';
  inputSchema = z.object({ positionDate: dateField });

  async execute(input: { positionDate?: string }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap?.data?.sales) throw new Error('No ingested sales found — run ingest-logistics-report first.');
    const sales: Sale[] = snap.data.sales;
    const blends = await loadBlendRecipes();
    const memory = await loadAssignmentMemory();
    const ambiguousKeys = globallyAmbiguousKeys(memory);

    const assigned: Sale[] = [];
    const pending: Array<Record<string, any>> = [];
    for (const sale of sales) {
      const m = matchBlend(sale, blends, { useAssigned: true, memory, ambiguousKeys });
      if (!m.needsConfirmation && m.blend) {
        assigned.push({ ...sale, blendNo: m.blend.blendNo });
      } else {
        assigned.push({ ...sale, blendNo: sale.blendNo ?? null });
        const seen = memory[assignmentKey(sale)];
        pending.push({
          positionDate: snap.data.positionDate,
          saleCtr: sale.saleCtr,
          client: sale.client,
          sGrade: sale.sGrade,
          sStrategy: sale.sStrategy,
          smt: sale.smt,
          month: sale.month,
          reason: m.reason,
          candidates: seen ? Object.keys(seen).map(Number) : [],
        });
      }
    }

    await saveSnapshot(snap.data.positionDate, { sales: assigned, pendingBlends: pending });
    await reconcilePendingBlends(snap.data.positionDate, pending);
    return {
      positionDate: snap.data.positionDate,
      autoAssigned: assigned.filter((s) => s.blendNo != null).length,
      pendingConfirmation: pending.map((p) => ({
        saleCtr: p.saleCtr,
        client: p.client,
        grade: p.sGrade,
        smt: p.smt,
        month: p.month,
        why: p.reason,
        candidateBlends: p.candidates,
      })),
      note: pending.length
        ? 'Ask the trader to confirm a blend number for each pending sale (confirm-blend). Their answers are remembered.'
        : 'All sales matched from memory.',
    };
  }
}

class ConfirmBlend implements LuaTool {
  name = 'confirm-blend';
  description = "Record the trader's blend choice for a flagged sale; the (client, grade, strategy) → blend assignment is remembered for the future.";
  inputSchema = z.object({
    saleCtr: z.string().describe('Sale contract, e.g. SSKE-103502'),
    blendNo: z.number().int().describe('Blend number the trader confirmed'),
    positionDate: dateField,
  });

  async execute(input: { saleCtr: string; blendNo: number; positionDate?: string }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap?.data?.sales) throw new Error('No ingested sales found for that date.');
    const blends = await loadBlendRecipes();
    if (!blends.some((b) => b.blendNo === input.blendNo)) {
      throw new Error(`Blend #${input.blendNo} does not exist in the recipe book.`);
    }

    const sales: Sale[] = snap.data.sales;
    const sale = sales.find((s) => s.saleCtr === input.saleCtr);
    if (!sale) throw new Error(`Sale ${input.saleCtr} not found in the ${snap.data.positionDate} snapshot.`);
    sale.blendNo = input.blendNo;

    await persistAssignment(assignmentKey(sale), input.blendNo);
    const pendingBlends = (snap.data.pendingBlends ?? []).filter((p: any) => p.saleCtr !== input.saleCtr);
    await saveSnapshot(snap.data.positionDate, { sales, pendingBlends });
    const res = await Data.get(COLLECTIONS.pendingBlends, { positionDate: snap.data.positionDate, saleCtr: input.saleCtr }, 1, 1);
    if (res?.data?.[0]?.id) await Data.delete(COLLECTIONS.pendingBlends, res.data[0].id);

    return {
      saleCtr: input.saleCtr,
      blendNo: input.blendNo,
      remaining: pendingBlends.length,
      note: 'Remembered for future sales with the same client/grade/strategy. Re-run compute-forward-sales to update the matrix.',
    };
  }
}

class ComputeForwardSales implements LuaTool {
  name = 'compute-forward-sales';
  description = 'Aggregate blend-allocated sales into the forward-sales matrix (POST grade × delivery month, bags negative).';
  inputSchema = z.object({ positionDate: dateField });

  async execute(input: { positionDate?: string }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap?.data?.sales) throw new Error('No ingested sales found — run ingest-logistics-report first.');
    const sales: Sale[] = snap.data.sales;
    const blends = await loadBlendRecipes();

    const result = computeForwardSales(sales, blends, { useAssigned: true });
    await saveSnapshot(snap.data.positionDate, {
      forwardSales: { matrix: result.matrix, byGrade: result.byGrade, months: result.months, pendingCount: result.pending.length },
    });

    const totalBags = Object.values(result.byGrade).reduce((s, v) => s + v, 0);
    return {
      positionDate: snap.data.positionDate,
      months: result.months,
      totalShortBags: round(totalBags),
      byGrade: Object.fromEntries(Object.entries(result.byGrade).map(([g, v]) => [g, round(v)])),
      excludedPendingSales: result.pending.length,
      note: result.pending.length
        ? `${result.pending.length} sale(s) without a confirmed blend are EXCLUDED from the matrix — confirm them for full parity.`
        : undefined,
      cite: citeLine({
        tool: this.name,
        positionDate: snap.data.positionDate,
        demo: snap.data.demo === true,
        updatedAt: snap.data.updatedAt,
        sources: ['SOL ReportLogistic + blend recipes'],
      }),
    };
  }
}

export const forwardsalesSkill = new LuaSkill({
  name: 'position-forwardsales',
  description: 'Shorts: blend allocation (human-gated learned matcher) and the forward-sales matrix by grade × delivery month.',
  context: `Shorts side of the position.
- assign-blends first: it auto-applies blends only where the desk's history is unambiguous; everything else is listed for the trader. NEVER guess a blend yourself — present the candidates and use confirm-blend with the trader's answer.
- confirm-blend both fixes the sale and teaches the matcher (the key won't be asked again unless it becomes ambiguous).
- compute-forward-sales builds the grade × month matrix; pending sales are excluded, so chase confirmations before quoting totals as final.
- Bags are negative (commitments out). POST FAQ MINUS is intentionally dropped from aggregation (workbook parity).`,
  tools: [new AssignBlends(), new ConfirmBlend(), new ComputeForwardSales()],
});
