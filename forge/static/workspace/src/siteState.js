/**
 * Pure site-screen logic (unit-tested in test/siteState.test.mjs).
 *
 * Never trust the shape of stored data: `walkdown.check` issue properties written by older versions
 * (e.g. the spike-3 test controls) have no `conflicts`/`touched` lists. On 2026-11-11 that crashed the
 * site page (`Cannot read properties of undefined (reading 'forEach')`).
 */
const list = (v) => (Array.isArray(v) ? v : []);

/** Coerce any stored `walkdown.check` value into the current shape (or null if it isn't one). */
export function normaliseCheck(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    ...raw,
    status: raw.status === 'conflict' ? 'conflict' : raw.status === 'clear' ? 'clear' : 'unknown',
    summary: typeof raw.summary === 'string' ? raw.summary : null,
    touched: list(raw.touched),
    conflicts: list(raw.conflicts).map((c) => ({ ...c, matched: list(c?.matched), guardsMatched: list(c?.guardsMatched), equipment: list(c?.equipment) })),
    acknowledged: list(raw.acknowledged),
    legacy: !Array.isArray(raw.conflicts),
  };
}

/** Standing decisions, blocked work orders, and model highlights ({ tag: 'decision' | 'blocked' }). */
export function deriveSiteState(decisions, orders) {
  const standing = list(decisions).filter((d) => d?.status === 'standing');
  const blockedOrders = list(orders).filter((o) => o?.check?.status === 'conflict');
  const highlights = {};
  for (const d of standing) for (const t of list(d.equipment)) highlights[t] = 'decision';
  for (const o of blockedOrders) for (const c of list(o.check.conflicts)) for (const t of list(c.matched)) highlights[t] = 'blocked';
  return { standing, blockedOrders, highlights };
}
