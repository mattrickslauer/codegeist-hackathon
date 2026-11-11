/**
 * The work-order check: is this Jira work order consistent with the standing decisions of its site?
 *
 * Deterministic and explainable (no LLM decides anything):
 *  1. Sites whose linked Jira space is this work order's project.
 *  2. Equipment the work order touches = tags found in its summary/description (word-bounded, so
 *     "RTU-1" never matches "RTU-10") ∪ tags set by hand (issue property `precedent.equipment`).
 *  3. A standing decision conflicts when it governs touched equipment AND (it guards no specific action,
 *     or the work order's text contains one of its guarded actions).
 *  4. Conflicts someone reaffirmed for this work order are acknowledged, not blocking.
 *  5. Result written to issue property `precedent.check` (read by the workflow validator and JQL index).
 */
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { listSites } from './sites';
import { getDecision, listDecisions, normaliseTag } from './decisions';
import { adfText, evaluate } from './match';

export const CHECK_PROPERTY = 'precedent.check';
export const EQUIPMENT_PROPERTY = 'precedent.equipment';
const CHECK_VERSION = 1;

const resolutionKey = (issueKey, decisionId) => `resolution:${issueKey}:${decisionId}`;

async function readJsonOrNull(res) {
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function getIssue(issueKey) {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=summary,description,project,status&properties=${CHECK_PROPERTY},${EQUIPMENT_PROPERTY}`,
  );
  const issue = await readJsonOrNull(res);
  if (!issue) throw new Error(`Work order ${issueKey} not found`);
  return issue;
}

async function setProperty(issueKey, propertyKey, value) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${propertyKey}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Writing ${propertyKey} on ${issueKey} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** One Jira comment that @mentions the decider, so Jira notifies them natively. */
async function commentNewConflict(issueKey, conflict) {
  const content = [
    { type: 'text', text: '⚠ Precedent: this work order conflicts with a standing decision: ' },
    { type: 'text', text: `"${conflict.statement}"`, marks: [{ type: 'strong' }] },
  ];
  if (conflict.decidedBy) {
    content.push({ type: 'text', text: ' (decided by ' }, { type: 'mention', attrs: { id: conflict.decidedBy } }, { type: 'text', text: ')' });
  }
  content.push({ type: 'text', text: `. Equipment: ${conflict.matched.join(', ')}. It can't start until someone reaffirms, supersedes or withdraws it in the Precedent panel.` });
  await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] } }),
  });
}

/**
 * Run the check for one work order and write `precedent.check`.
 * Returns the written value, or { status: 'unlinked' } when no Precedent site guards this space.
 */
export async function checkWorkOrder(issueKey) {
  const issue = await getIssue(issueKey);
  const projectKey = issue.fields.project.key;
  const sites = (await listSites()).filter((s) => s.space?.key === projectKey);
  const previous = issue.properties?.[CHECK_PROPERTY] ?? null;
  if (!sites.length) return { status: 'unlinked', projectKey };

  const text = `${issue.fields.summary ?? ''}\n${adfText(issue.fields.description)}`;
  const manualTags = issue.properties?.[EQUIPMENT_PROPERTY]?.tags ?? [];
  const decisions = (await Promise.all(sites.map((s) => listDecisions(s.id)))).flat();
  const resolutions = {};
  for (const d of decisions) {
    const r = await kvs.get(resolutionKey(issueKey, d.id));
    if (r) resolutions[d.id] = r;
  }

  const { touched, conflicts, acknowledged } = evaluate({ text, manualTags, decisions, resolutions });
  const value = {
    version: CHECK_VERSION,
    status: conflicts.length ? 'conflict' : 'clear',
    siteId: (conflicts[0] ?? acknowledged[0])?.siteId ?? sites[0].id,
    summary: conflicts[0]?.statement ?? null,
    touched,
    conflicts,
    acknowledged,
    notified: previous?.notified ?? [],
    checkedAt: new Date().toISOString(),
  };

  // Notify once per (work order, decision): new conflicts only.
  for (const c of conflicts) {
    if (!value.notified.includes(c.decisionId)) {
      try {
        await commentNewConflict(issueKey, c);
        value.notified.push(c.decisionId);
      } catch (err) {
        console.error(`Comment on ${issueKey} failed: ${err.message}`);
      }
    }
  }
  await setProperty(issueKey, CHECK_PROPERTY, value);
  return value;
}

/** Can the current user edit this work order? (Resolutions are edits; viewers can't make them.) */
async function assertCanEdit(issueKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?issueKey=${issueKey}&permissions=EDIT_ISSUES`);
  const body = await readJsonOrNull(res);
  if (!body?.permissions?.EDIT_ISSUES?.havePermission) throw new Error('You need permission to edit this work order');
}

/** Reaffirm: the work order is consistent with the decision after all; record who and why, then re-check. */
export async function reaffirm({ issueKey, siteId, decisionId, reason }, accountId) {
  await assertCanEdit(issueKey);
  await getDecision(siteId, decisionId);
  const why = String(reason ?? '').trim();
  if (why.length < 5) throw new Error('Say why the work order is consistent with the decision');
  await kvs.set(resolutionKey(issueKey, decisionId), { type: 'reaffirm', reason: why.slice(0, 1000), by: accountId, at: new Date().toISOString() });
  return checkWorkOrder(issueKey);
}

/** Record a resolution created by an approved supersession, so the approved replacement doesn't re-block this work order. */
export async function acknowledgeForIssue(issueKey, decisionId, accountId, reason) {
  await kvs.set(resolutionKey(issueKey, decisionId), { type: 'reaffirm', reason, by: accountId, at: new Date().toISOString() });
}

/** Set the equipment tags a work order touches by hand (in addition to detected tags), then re-check. */
export async function setWorkOrderEquipment({ issueKey, tags }) {
  await assertCanEdit(issueKey);
  const list = [...new Set((Array.isArray(tags) ? tags : []).map(normaliseTag).filter(Boolean))].slice(0, 20);
  await setProperty(issueKey, EQUIPMENT_PROPERTY, { tags: list });
  return checkWorkOrder(issueKey);
}
