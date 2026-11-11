/** Equipment tag helpers (pure, unit-tested in test/actions.test.mjs). */

/** Normalise a tag typed by a person or an agent: " rtu 2 ", "rtu-2", "RTU2" → "RTU-2". */
export function normaliseTagInput(tag) {
  const t = String(tag ?? '').trim().toUpperCase().replace(/\s+/g, '-');
  return t.replace(/^([A-Z]+)-?(\d+)$/, '$1-$2');
}
