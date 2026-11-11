/**
 * Decisions: what was decided about a place, why, which equipment it governs, and which actions it guards.
 *
 * Stored in Forge KVS under `decision:<siteId>:<decisionId>` so a site's decisions list with one prefix query.
 * A decision governs equipment by TAG (e.g. "RTU-1", "V-12"), so it works with Assets equipment and
 * with free-form tags on sites that have no Assets data.
 *
 * Lifecycle: standing → superseded (by an approved replacement) | withdrawn.
 *            proposed → standing (approved) | rejected.
 * Contract: docs/ARCHITECTURE.md §5.2.
 */
import { kvs, WhereConditions } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { getSite } from './sites';

const PREFIX = 'decision:';
const MAX_STATEMENT = 300;
const MAX_REASON = 1000;
const MAX_TAGS = 20;
const MAX_GUARDS = 15;

/** Normalised equipment tag: trimmed, uppercased ("rtu-1 " → "RTU-1"). */
export const normaliseTag = (tag) => String(tag ?? '').trim().toUpperCase();

function text(value, field, max, { required = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new Error(`${field} is required`);
    return '';
  }
  const s = String(value).trim();
  if (s.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return s;
}

function tagList(values, field, max, normalise = normaliseTag) {
  const list = [...new Set((Array.isArray(values) ? values : []).map(normalise).filter(Boolean))];
  if (list.length > max) throw new Error(`At most ${max} ${field}`);
  return list;
}

/** Optional pin on a scan: which scan, and where (metres, scan coordinates). */
function pin(value) {
  if (!value) return null;
  const point = Array.isArray(value.point) && value.point.length === 3 && value.point.every(Number.isFinite) ? value.point : null;
  if (!point || typeof value.scanKey !== 'string' || !value.scanKey.startsWith('scans/')) throw new Error('Invalid pin');
  return { scanKey: value.scanKey, point, normal: Array.isArray(value.normal) ? value.normal : null };
}

const key = (siteId, id) => `${PREFIX}${siteId}:${id}`;

export async function listDecisions(siteId) {
  if (!siteId) throw new Error('siteId is required');
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(`${PREFIX}${siteId}:`)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return out.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

export async function getDecision(siteId, id) {
  const d = await kvs.get(key(siteId, id));
  if (!d) throw new Error('Decision not found');
  return d;
}

/**
 * Record a decision.
 * guards: action phrases that make a work order conflict ("shut down", "isolate"). Empty = any work on the
 * governed equipment needs review before it starts.
 */
export async function createDecision(input, accountId, { status = 'standing', supersedes = null, originIssueKey = null } = {}) {
  await getSite(input?.siteId); // site must exist
  const now = new Date().toISOString();
  const decision = {
    id: randomUUID(),
    siteId: input.siteId,
    statement: text(input.statement, 'Decision', MAX_STATEMENT),
    reason: text(input.reason, 'Reason', MAX_REASON, { required: false }),
    equipment: tagList(input.equipment, 'equipment tags', MAX_TAGS),
    guards: tagList(input.guards, 'guarded actions', MAX_GUARDS, (g) => String(g ?? '').trim().toLowerCase()),
    pin: pin(input.pin),
    status,
    supersedes,
    supersededBy: null,
    originIssueKey: typeof originIssueKey === 'string' && /^[A-Z][A-Z0-9_]+-\d+$/.test(originIssueKey) ? originIssueKey : null,
    decidedBy: accountId ?? null,
    decidedAt: input.decidedAt && /^\d{4}-\d{2}-\d{2}/.test(input.decidedAt) ? input.decidedAt : now,
    createdAt: now,
    approvedBy: null,
    approvedAt: null,
  };
  if (!decision.equipment.length) throw new Error('Link at least one piece of equipment (tag) the decision governs');
  await kvs.set(key(decision.siteId, decision.id), decision);
  return decision;
}

/** Propose a replacement for a standing decision. It stays `proposed` until an approver accepts it. */
export async function proposeSupersession(input, accountId) {
  const old = await getDecision(input?.siteId, input?.decisionId);
  if (old.status !== 'standing') throw new Error('Only a standing decision can be superseded');
  const proposal = await createDecision(
    {
      siteId: old.siteId,
      statement: input.statement,
      reason: input.reason,
      equipment: input.equipment?.length ? input.equipment : old.equipment,
      guards: input.guards ?? old.guards,
      pin: old.pin,
    },
    accountId,
    { status: 'proposed', supersedes: old.id, originIssueKey: input.issueKey ?? null },
  );
  return { proposal, original: old };
}

/**
 * Approve a proposed decision: it becomes standing and the decision it supersedes becomes superseded.
 * Only a site approver may approve (site.approvers, defaulting to the site's creator).
 */
export async function approveDecision(input, accountId) {
  const site = await getSite(input?.siteId);
  const approvers = site.approvers?.length ? site.approvers : [site.createdBy].filter(Boolean);
  if (!approvers.includes(accountId)) throw new Error('Only a site approver can approve a supersession');
  const proposal = await getDecision(site.id, input.decisionId);
  if (proposal.status !== 'proposed') throw new Error('This decision is not awaiting approval');
  const now = new Date().toISOString();

  let original = null;
  if (proposal.supersedes) {
    original = await getDecision(site.id, proposal.supersedes);
    if (original.status !== 'standing') throw new Error('The decision being replaced is no longer standing');
    original = { ...original, status: 'superseded', supersededBy: proposal.id };
    await kvs.set(key(site.id, original.id), original);
  }
  const approved = { ...proposal, status: 'standing', approvedBy: accountId, approvedAt: now, decidedAt: now };
  await kvs.set(key(site.id, approved.id), approved);
  return { approved, superseded: original, selfApproved: approved.decidedBy === accountId };
}

export async function withdrawDecision(input) {
  const d = await getDecision(input?.siteId, input?.decisionId);
  if (!['standing', 'proposed'].includes(d.status)) throw new Error('Decision is already closed');
  const updated = { ...d, status: d.status === 'proposed' ? 'rejected' : 'withdrawn' };
  await kvs.set(key(d.siteId, d.id), updated);
  return updated;
}
