/**
 * Precedent backend: the resolver behind every Custom UI `invoke` call.
 * Function inventory and contracts live in docs/ARCHITECTURE.md (the canonical doc).
 */
import Resolver from '@forge/resolver';
import objectStore from '@forge/object-store';
import { addScanToSite, createSite, deleteSite, getSite, listSites, loadSampleSite, updateSite } from './sites';
import api, { route } from '@forge/api';
import { ensureAssetsModel, exbImportPlan, importExbStep, listSiteEquipment, probeAssets } from './assets';
import { approveDecision, createDecision, getDecision, listDecisions, proposeSupersession, withdrawDecision } from './decisions';
import { acknowledgeForIssue, checkWorkOrder, reaffirm, setWorkOrderEquipment } from './check';
import { loadSampleBuilding } from './samples';
import { spikeAssetsRefs } from './spikes/assetsRefs';
import { getEquipmentContext } from './actions';
import { deleteGraph, editSiteGraph, equipmentContextForSite, getSiteGraph, graphHistory, startSiteGraph, undoSiteGraph } from './graph';

/** Bumped by hand when the backend contract changes; the UI shows it so we can confirm which build is live. */
export const BACKEND_VERSION = '0.5.0';

/** Throws unless the signed-in user can see this work order (the check itself runs asApp). */
async function assertCanView(issueKey) {
  if (typeof issueKey !== 'string' || !/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) throw new Error('Invalid work order key');
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Work order not found' : `You can't view ${issueKey}`);
}

/** Largest scan we accept (bytes). Object Store allows 1 GB; real phone scans are ~15–25 MB. */
export const MAX_SCAN_BYTES = 200 * 1024 * 1024;

/** Every scan lives under this prefix; download requests for any other key are refused. */
const SCAN_PREFIX = 'scans/';

const resolver = new Resolver();

/**
 * ping: health check for the frontend → backend path.
 * Returns the backend version and the calling user's account ID (from the Forge context, never trusted from the payload).
 */
resolver.define('ping', ({ context }) => ({
  ok: true,
  backendVersion: BACKEND_VERSION,
  accountId: context.accountId ?? null,
  serverTime: new Date().toISOString(),
}));

/** base64 → base64url (no '+', '/', '='), so a checksum can be used safely inside an object key. */
export const base64ToBase64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Content-addressed key under a prefix: the same bytes always map to the same key. */
const contentKey = (prefix, sha256Base64) => `${prefix}sha256-${base64ToBase64Url(sha256Base64)}`;
export const scanKeyFor = (sha256Base64) => contentKey(SCAN_PREFIX, sha256Base64);

/** Original photos (closeout evidence, spike 8). Same size cap as scans; bytes are never transformed. */
const PHOTO_PREFIX = 'photos/';

/**
 * Upload signing for the `objectStore.upload` bridge (functionKey).
 * Bridge contract: payload `{ allObjectMetadata: [{ length, checksum, checksumType }] }`
 * → returns `{ [presignedPutUrl]: { key, length, checksum, checksumType } }`.
 * The browser then PUTs each file straight to its URL; file bytes never pass through this function.
 */
async function signUploads(prefix, payload) {
  const items = payload?.allObjectMetadata;
  if (!Array.isArray(items) || items.length === 0) throw new Error('allObjectMetadata is required');

  const mapping = {};
  for (const { length, checksum, checksumType } of items) {
    if (checksumType !== 'SHA256') throw new Error(`Unsupported checksum type: ${checksumType}`);
    if (!Number.isInteger(length) || length <= 0 || length > MAX_SCAN_BYTES) {
      throw new Error(`File size ${length} bytes is outside the allowed range (1 B – ${MAX_SCAN_BYTES} B)`);
    }
    const key = contentKey(prefix, checksum);
    const res = await objectStore.createUploadUrl({ key, length, checksum, checksumType, overwrite: true });
    if (!res?.url) throw new Error(`Object Store returned no upload URL for ${key}`);
    console.log(`upload url host=${new URL(res.url).host} key=${key} length=${length}`);
    mapping[res.url] = { key, length, checksum, checksumType };
  }
  return mapping;
}

/**
 * Download signing for the `objectStore.download` bridge (functionKey).
 * Bridge contract: payload `{ keys: string[] }` → returns `{ [presignedGetUrl]: key }`. Only keys under `prefix`.
 */
async function signDownloads(prefix, payload) {
  const keys = payload?.keys;
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('keys is required');

  const mapping = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) throw new Error(`Refusing to sign key outside ${prefix}`);
    const res = await objectStore.createDownloadUrl(key);
    if (!res?.url) throw new Error(`No object found for ${key}`);
    mapping[res.url] = key;
  }
  return mapping;
}

resolver.define('getScanUploadUrls', ({ payload }) => signUploads(SCAN_PREFIX, payload));
resolver.define('getScanDownloadUrls', ({ payload }) => signDownloads(SCAN_PREFIX, payload));
// Spike 8: original photos from the JSM portal. TODO (closeout plan): only for participants of the request.
resolver.define('getPhotoUploadUrls', ({ payload }) => signUploads(PHOTO_PREFIX, payload));
resolver.define('getPhotoDownloadUrls', ({ payload }) => signDownloads(PHOTO_PREFIX, payload));

// Sites (KVS). The caller's account ID always comes from the Forge context, never the payload.
resolver.define('listSites', () => listSites());
resolver.define('getSite', ({ payload }) => getSite(payload?.id));
resolver.define('createSite', ({ payload, context }) => createSite(payload, context.accountId));
resolver.define('updateSite', ({ payload }) => updateSite(payload));
resolver.define('deleteSite', async ({ payload }) => {
  const result = await deleteSite(payload?.id);
  await deleteGraph(payload.id); // the site's building graph goes with it
  return result;
});
resolver.define('addScanToSite', ({ payload, context }) => addScanToSite(payload, context.accountId));
resolver.define('loadSampleSite', ({ payload, context }) => loadSampleSite(payload, context.accountId));

// Jira Assets (spike 4). Runs asApp; each call is one small idempotent step.
resolver.define('assetsProbe', () => probeAssets());
resolver.define('assetsSetup', () => ensureAssetsModel());
resolver.define('assetsImportPlan', () => exbImportPlan());
resolver.define('assetsImportStep', ({ payload }) => importExbStep(payload ?? {}));
// Spike 7: Assets reference attributes + app-account writes (Diagnostics only).
resolver.define('spikeAssetsRefs', () => spikeAssetsRefs());
// Spike 9: run the Rovo action's logic directly, to separate "action works" from "Rovo calls it".
resolver.define('spikeEquipmentContext', ({ payload }) => getEquipmentContext(payload));
// Spike 10: what a clean (judge-like) site offers this app. Rovo availability is checked by hand.
resolver.define('spikeCleanSite', async ({ context }) => {
  const out = { backendVersion: BACKEND_VERSION, installContext: context.installContext ?? null, assets: null, sites: null, errors: [] };
  try { out.assets = await probeAssets(); } catch (err) { out.errors.push(`assets: ${err.message}`); }
  try { out.sites = (await listSites()).length; } catch (err) { out.errors.push(`sites: ${err.message}`); }
  return out;
});

// Building context graph: one piece of equipment's power chain, served areas, connections and support.
resolver.define('getEquipmentContext', ({ payload }) => equipmentContextForSite(payload?.siteId, payload?.tag));

// Systems editor (§6.8): the whole site graph, edits with undo, history. The editor's account comes from the context.
resolver.define('getSiteGraph', ({ payload }) => getSiteGraph(payload?.siteId));
resolver.define('startSiteGraph', ({ payload, context }) => startSiteGraph(payload?.siteId, context.accountId));
resolver.define('editSiteGraph', ({ payload, context }) => editSiteGraph(payload ?? {}, context.accountId));
resolver.define('undoSiteGraph', ({ payload, context }) => undoSiteGraph(payload ?? {}, context.accountId));
resolver.define('graphHistory', ({ payload }) => graphHistory(payload?.siteId));

// Site equipment (live from Assets, seed fallback).
resolver.define('getSiteEquipment', async ({ payload }) => {
  const site = await getSite(payload?.siteId);
  if (site.equipmentSource?.kind !== 'assets') return { source: 'none', equipment: [] };
  return listSiteEquipment(site.equipmentSource.siteName);
});

// Decisions.
resolver.define('listDecisions', ({ payload }) => listDecisions(payload?.siteId));
resolver.define('createDecision', ({ payload, context }) => createDecision(payload, context.accountId));
resolver.define('withdrawDecision', ({ payload }) => withdrawDecision(payload));
resolver.define('proposeSupersession', async ({ payload, context }) => {
  if (payload?.issueKey) await assertCanView(payload.issueKey);
  return proposeSupersession(payload, context.accountId);
});
resolver.define('approveDecision', async ({ payload, context }) => {
  const result = await approveDecision(payload, context.accountId);
  // The approved replacement was agreed for the work order that raised it: release that work order.
  const origin = result.approved.originIssueKey;
  if (origin) {
    await acknowledgeForIssue(origin, result.approved.id, context.accountId, 'Approved supersession raised from this work order');
    result.recheck = await checkWorkOrder(origin);
  }
  return result;
});
resolver.define('loadSampleBuilding', ({ payload, context }) => loadSampleBuilding(payload, context.accountId));

// Work orders (issue panel).
resolver.define('checkWorkOrder', async ({ payload }) => {
  await assertCanView(payload?.issueKey);
  return checkWorkOrder(payload.issueKey);
});
resolver.define('reaffirmConflict', ({ payload, context }) => reaffirm(payload ?? {}, context.accountId));
resolver.define('setWorkOrderEquipment', ({ payload }) => setWorkOrderEquipment(payload ?? {}));
resolver.define('getDecision', ({ payload }) => getDecision(payload?.siteId, payload?.decisionId));

/**
 * Spike 8: who is calling from the JSM portal panel, and are they on this request?
 * The request key comes from the Forge context (not the payload). Reporter/participants are read asApp.
 */
resolver.define('portalWhoAmI', async ({ context }) => {
  const accountId = context.accountId ?? null;
  const requestKey = context.extension?.request?.key ?? null;
  const out = { accountId, requestKey, extensionType: context.extension?.type ?? null, canSeeRequest: false, reporter: null, participants: [], errors: [] };
  if (!requestKey || !accountId) return out;
  try {
    const req = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${requestKey}`);
    if (req.ok) out.reporter = (await req.json()).reporter?.accountId ?? null;
    else out.errors.push(`request ${req.status}`);
    const parts = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${requestKey}/participant`);
    if (parts.ok) out.participants = ((await parts.json()).values ?? []).map((p) => p.accountId);
    else out.errors.push(`participants ${parts.status}`);
  } catch (err) {
    out.errors.push(err.message);
  }
  out.canSeeRequest = out.reporter === accountId || out.participants.includes(accountId);
  return out;
});

export const handler = resolver.getDefinitions();

/**
 * Product trigger: a work order was created or updated → run the check (asApp).
 * Self-generated events are filtered in the manifest (ignoreSelf), so our own property writes don't loop.
 */
export async function onWorkOrderEvent(event) {
  const issueKey = event?.issue?.key;
  if (!issueKey) return;
  try {
    const result = await checkWorkOrder(issueKey);
    console.log(`check ${issueKey}: ${result.status}${result.conflicts ? ` (${result.conflicts.length} conflicts)` : ''}`);
  } catch (err) {
    console.error(`check ${issueKey} failed: ${err.message}`);
  }
}
