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

/**
 * Loose key without the strategy. The strategy field is VOLATILE across
 * sources — the golden BASE FILE says "KEMBA" where both live SOL exports say
 * "CAFEXPORT" (or blank) for the same contracts — so exact keys learned from
 * one snapshot can miss live parses. Matching falls back to this key
 * (validated 0-wrong on the golden day) when the exact key has no history.
 */
export function looseAssignmentKey(sale: Sale): string {
  return [normClient(sale.client), normGrade(sale.sGrade || '')].join('|');
}

/** Collapse an exact-key memory to the loose (client|grade) keyspace. */
export function collapseToLoose(mem: AssignmentMemory): AssignmentMemory {
  const loose: AssignmentMemory = {};
  for (const [key, counts] of Object.entries(mem)) {
    const lk = key.split('|').slice(0, 2).join('|');
    for (const [blendNo, n] of Object.entries(counts)) {
      (loose[lk] ||= {})[Number(blendNo)] = (loose[lk][Number(blendNo)] || 0) + n;
    }
  }
  return loose;
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
 * Keys that have EVER legitimately mapped to more than one blend (e.g.
 * 32CUP/NAT.SPECIALTY → #91 and #100). Once a key is known-ambiguous it must
 * always be flagged, even when a partial history slice shows a single
 * candidate — auto-applying there is where silent mis-allocations came from.
 * Build this from the full assignment history and persist it alongside the
 * memory.
 */
export function globallyAmbiguousKeys(mem: AssignmentMemory): Set<string> {
  const out = new Set(Object.keys(mem).filter((k) => Object.keys(mem[k]).length > 1));
  // Loose (client|grade) keys that are ambiguous once the volatile strategy
  // segment is dropped — the loose fallback tier must flag these too. The two
  // keyspaces (3-part vs 2-part) cannot collide in one set.
  const loose = collapseToLoose(mem);
  for (const k of Object.keys(loose)) if (Object.keys(loose[k]).length > 1) out.add(k);
  return out;
}

/**
 * Resolve a sale to a blend.
 *
 * Precedence:
 *  1. `sale.blendNo` already set and `useAssigned` → trust it ('assigned').
 *  2. Loose (client, grade) key in `ambiguousKeys` → 'medium' (ALWAYS flag).
 *     The strategy field is volatile across SOL snapshots and can actively
 *     mislead (golden day: four KEMBA sales re-exported as CAFEXPORT, which
 *     collided with a different CAFEXPORT sale's blend). When the same
 *     client+grade has ever taken >1 blend, no live field reliably picks
 *     between them — a human must.
 *  3. Exact (client, grade, strategy) unique in memory → 'high' (auto-apply).
 *  4. Loose (client, grade) unique in memory           → 'high' (auto-apply).
 *  5. Seen but multiple candidates (partial history)   → 'medium' (flag).
 *  6. Unseen at both tiers → 'none' (flag; trader assigns, then remembered).
 */
export function matchBlend(
  sale: Sale,
  blends: Blend[],
  opts: { useAssigned?: boolean; memory?: AssignmentMemory; ambiguousKeys?: Set<string> } = {}
): BlendMatch {
  const { useAssigned = true, memory = {}, ambiguousKeys } = opts;
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

  const rank = (counts: Record<number, number>): number[] =>
    Object.keys(counts).map(Number).sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

  const exactSeen = memory[assignmentKey(sale)];
  const looseKey = looseAssignmentKey(sale);
  const looseSeen = collapseToLoose(memory)[looseKey];

  // 2. Client+grade has ever taken more than one blend → always a human call.
  //    Prefer the exact key's history as the top candidate suggestion.
  if (ambiguousKeys?.has(looseKey) || ambiguousKeys?.has(assignmentKey(sale))) {
    const candidates = exactSeen ? rank(exactSeen) : looseSeen ? rank(looseSeen) : [];
    return {
      sale,
      blend: candidates.length ? findBlend(candidates[0]) : null,
      confidence: 'medium',
      reason: `Known-ambiguous (${sale.client}/${sale.sGrade})${candidates.length ? ` — candidates ${candidates.map((c) => '#' + c).join(', ')}` : ''}; confirm`,
      needsConfirmation: true,
    };
  }

  // 3./4. Unique history at either tier → auto-apply.
  for (const [seen, how] of [[exactSeen, 'client+grade+strategy'], [looseSeen, 'client+grade']] as const) {
    if (!seen) continue;
    const candidates = rank(seen);
    if (candidates.length === 1) {
      return {
        sale,
        blend: findBlend(candidates[0]),
        confidence: 'high',
        reason: `Learned (${how}): ${sale.client}/${sale.sGrade} → blend #${candidates[0]}`,
        needsConfirmation: false,
      };
    }
    // 5. Multiple candidates without a registry hit (partial history) → flag.
    return {
      sale,
      blend: findBlend(candidates[0]),
      confidence: 'medium',
      reason: `Ambiguous history — blends ${candidates.map((c) => '#' + c).join(', ')}; confirm`,
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
