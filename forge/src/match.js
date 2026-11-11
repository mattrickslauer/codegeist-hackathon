/**
 * Pure matching logic for the work-order check (no Forge imports, so it's unit-testable with node --test).
 * See check.js for how it's used, and test/match.test.mjs for the cases it must handle.
 */
const normaliseTag = (tag) => String(tag ?? '').trim().toUpperCase();

/** Plain text from an Atlassian Document Format node (Jira descriptions are ADF in REST v3). */
export function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'mention') return node.attrs?.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const children = (node.content ?? []).map(adfText);
  // Inline runs (paragraph/heading text split by marks, e.g. "shut " + bold "down") join with nothing;
  // block nodes (paragraphs, list items, table cells…) are separated by newlines.
  return ['paragraph', 'heading'].includes(node.type) ? children.join('') : children.join('\n');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tags (from `candidates`) that appear in `text` as whole tokens. */
export function detectTags(text, candidates) {
  const hay = String(text ?? '').toUpperCase();
  return candidates.filter((tag) => new RegExp(`(^|[^A-Z0-9-])${escapeRe(tag)}(?![A-Z0-9])`).test(hay));
}

/** Guarded action phrases (lowercase) found in `text` as whole words/phrases. */
export function detectGuards(text, guards) {
  const hay = String(text ?? '').toLowerCase();
  return guards.filter((g) => new RegExp(`(^|[^a-z0-9])${escapeRe(g)}([^a-z0-9]|$)`).test(hay));
}

/** Pure decision logic, unit-testable: which decisions conflict, which are acknowledged. */
export function evaluate({ text, manualTags, decisions, resolutions }) {
  const standing = decisions.filter((d) => d.status === 'standing');
  const candidates = [...new Set(standing.flatMap((d) => d.equipment))];
  const touched = [...new Set([...detectTags(text, candidates), ...manualTags.map(normaliseTag)])];
  const conflicts = [];
  const acknowledged = [];
  for (const d of standing) {
    const matched = d.equipment.filter((t) => touched.includes(t));
    if (!matched.length) continue;
    const guardsMatched = d.guards.length ? detectGuards(text, d.guards) : [];
    if (d.guards.length && !guardsMatched.length) continue;
    const item = {
      decisionId: d.id, siteId: d.siteId, statement: d.statement, reason: d.reason, equipment: d.equipment,
      matched, guardsMatched, decidedBy: d.decidedBy, decidedAt: d.decidedAt, pin: d.pin ?? null,
    };
    const res = resolutions[d.id];
    if (res?.type === 'reaffirm') acknowledged.push({ ...item, resolution: res });
    else conflicts.push(item);
  }
  return { touched, conflicts, acknowledged };
}
