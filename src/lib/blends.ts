import { Blend, Sale, BlendMatch } from './types';
import { normGrade } from './grades';

/**
 * Blend resolution.
 *
 * KEY FINDING (validated against the 2026-06-18 book): the `Blends` sheet's
 * client / grade / cup-profile columns are human *labels* for each recipe —
 * they do NOT determine which blend a sale gets. Ivo assigns a blend per sale
 * by judgement, and a sale for client X routinely uses a recipe labelled for a
 * different client. So we cannot auto-match on those label columns.
 *
 * What IS learnable: his assignments are consistent by
 * `(client, sold-grade, strategy)` — most such keys map to a single blend
 * historically. So we resolve blends from a **learned assignment memory**
 * seeded from past assignments: a unique historical blend for the key is
 * auto-applied; a new or historically-ambiguous key is flagged for the trader
 * to confirm, and the confirmation is remembered. This mirrors the "supplier →
 * classification memory, updatable by telling the agent" pattern in the design doc.
 */

export function loadBlends(seed: { blends: any[] }): Blend[] {
  return seed.blends
    .filter((b) => b.blendNo != null)
    .map((b) => ({
      blendNo: Number(b.blendNo),
      client: b.client ?? null,
      grade: b.grade ?? null,
      cupProfile: b.cupProfile ?? null,
      recipe: b.recipe ?? {},
    }));
}

const normClient = (s: string | null | undefined): string =>
  String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Assignment-memory key: what Ivo's blend choice is consistent on. */
export function assignmentKey(sale: Sale): string {
  return [normClient(sale.client), normGrade(sale.sGrade || ''), normClient(sale.sStrategy)].join('|');
}

/** key → (blendNo → times seen). Built from historical assignments. */
export type AssignmentMemory = Record<string, Record<number, number>>;

export function buildAssignmentMemory(history: Sale[]): AssignmentMemory {
  const mem: AssignmentMemory = {};
  for (const s of history) {
    if (s.blendNo == null) continue;
    const k = assignmentKey(s);
    (mem[k] ||= {})[s.blendNo] = (mem[k][s.blendNo] || 0) + 1;
  }
  return mem;
}

/** Record a confirmed assignment into memory (call after a trader confirms). */
export function rememberAssignment(mem: AssignmentMemory, sale: Sale, blendNo: number): void {
  const k = assignmentKey(sale);
  (mem[k] ||= {})[blendNo] = (mem[k][blendNo] || 0) + 1;
}

/**
 * Resolve a sale to a blend.
 *
 * Precedence:
 *  1. `sale.blendNo` already set and `useAssigned` → trust it ('assigned').
 *  2. Learned memory for the (client, grade, strategy) key:
 *       - unique blend           → 'high'   (auto-apply)
 *       - multiple historical     → 'medium' (flag; candidates listed)
 *  3. Unseen key                  → 'none'   (flag; trader assigns, then remembered)
 */
export function matchBlend(
  sale: Sale,
  blends: Blend[],
  opts: { useAssigned?: boolean; memory?: AssignmentMemory } = {}
): BlendMatch {
  const { useAssigned = true, memory = {} } = opts;
  const findBlend = (n: number) => blends.find((b) => b.blendNo === n) ?? null;

  if (useAssigned && sale.blendNo != null) {
    const b = findBlend(sale.blendNo);
    return {
      sale,
      blend: b,
      confidence: b ? 'assigned' : 'none',
      reason: b ? `Blend #${sale.blendNo} assigned in source` : `Assigned blend #${sale.blendNo} not found`,
      needsConfirmation: !b,
    };
  }

  const seen = memory[assignmentKey(sale)];
  if (seen) {
    const candidates = Object.keys(seen).map(Number).sort((a, b) => (seen[b] || 0) - (seen[a] || 0));
    if (candidates.length === 1) {
      return {
        sale,
        blend: findBlend(candidates[0]),
        confidence: 'high',
        reason: `Learned: ${sale.client}/${sale.sGrade} → blend #${candidates[0]}`,
        needsConfirmation: false,
      };
    }
    return {
      sale,
      blend: findBlend(candidates[0]),
      confidence: 'medium',
      reason: `Historically ambiguous — blends ${candidates.map((c) => '#' + c).join(', ')}; confirm`,
      needsConfirmation: true,
    };
  }

  return {
    sale,
    blend: null,
    confidence: 'none',
    reason: `New (${sale.client}/${sale.sGrade}) — no prior assignment; confirm blend`,
    needsConfirmation: true,
  };
}
