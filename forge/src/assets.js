/**
 * Jira Service Management Assets integration (spike 4).
 *
 * Precedent keeps its own Assets schema (key PREC) so it works on any site, including a judge's:
 *   Site  ──  Level  ──  Equipment     (object types; Site/Level/Equipment names are the object Name)
 *
 * Calls go through requestJira on the workspace-scoped Assets REST API (reads asApp, setup/import asUser):
 *   /jsm/assets/workspace/{workspaceId}/v1/...
 * Every step is idempotent (find by name, create only if missing) and small, so the UI can drive
 * an import one item at a time without hitting the 25 s resolver limit.
 */
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import seed from './seed/exb.json';

/** KVS key caching the ids from ensureAssetsModel(), so per-object steps don't re-walk the schema. */
const MODEL_CACHE_KEY = 'assets:model';

export const SCHEMA_KEY = 'PREC';
const SCHEMA_NAME = 'Precedent';

// Assets attribute data types (defaultTypeId).
const TEXT = 0;
const TEXTAREA = 9;
const DOUBLE = 3;

// Assets rejects long descriptions on schemas/types (HTTP 400 "ObjectSchemaBean.Size.description" at 90 chars;
// the longest existing one on the dev site is 80). Keep every description under 50 characters.
const TYPE_DEFS = [
  { name: 'Site', icon: 'Building', description: 'A building or plant', attributes: [
    ['Code', TEXT], ['Description', TEXTAREA],
  ] },
  { name: 'Level', icon: 'Building', description: 'A storey or area of a site', attributes: [
    ['Code', TEXT], ['Site', TEXT], ['Elevation (ft)', DOUBLE], ['Height (ft)', DOUBLE],
  ] },
  { name: 'Equipment', icon: 'Gears', description: 'Equipment governed by site decisions', attributes: [
    ['Site', TEXT], ['Level', TEXT], ['Category', TEXT], ['System', TEXT], ['Serves', TEXT],
    ['Manufacturer', TEXT], ['Model', TEXT], ['Specs', TEXTAREA], ['Source sheet', TEXT], ['Grid', TEXT],
    ['IFC GlobalId', TEXT], ['IFC class', TEXT],
  ] },
];

export async function readJson(res, what) {
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${what} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Who makes the call.
 * - READ as the app (asApp): works without a user, so the background work-order check can use it.
 * - SETUP/IMPORT as the user (asUser): creating an Assets schema is an admin action, and the app's own
 *   account isn't an Assets admin (2026-11-09: HTTP 403 "you do not have permission" asApp, while the
 *   installing user is in assets-admins). The person running setup is the site admin who installed the app.
 */
export const AS_APP = () => api.asApp();
export const AS_USER = () => api.asUser();

/** The site's Assets workspace id (null if Assets isn't available on this site). */
export async function getWorkspaceId(who = AS_APP) {
  const res = await who().requestJira(route`/rest/servicedeskapi/assets/workspace`);
  if (res.status === 404 || res.status === 403) return null;
  const body = await readJson(res, 'Get Assets workspace');
  return body?.values?.[0]?.workspaceId ?? null;
}

export const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Assets REST client bound to a caller (AS_APP or AS_USER). */
export const assetsClient = (who) => ({
  listSchemas: async (ws) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/objectschema/list`), 'List schemas'),
  createSchema: async (ws, body) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/objectschema/create`, json(body)), 'Create schema'),
  listTypes: async (ws, schemaId) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/objectschema/${schemaId}/objecttypes/flat`), 'List object types'),
  createType: async (ws, body) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/objecttype/create`, json(body)), 'Create object type'),
  listAttributes: async (ws, typeId) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/objecttype/${typeId}/attributes`), 'List attributes'),
  createAttribute: async (ws, typeId, body) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/objecttypeattribute/${typeId}`, json(body)), 'Create attribute'),
  icons: async (ws) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/icon/global`), 'List icons'),
  aql: async (ws, qlQuery) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/object/aql?maxResults=${1}`, json({ qlQuery })), 'AQL query'),
  createObject: async (ws, body) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/object/create`, json(body)), 'Create object'),
});

/** Read-only client (the app). */
const assets = assetsClient(AS_APP);
/** Setup/import client (the signed-in admin). */
const assetsAsUser = assetsClient(AS_USER);

/** Probe: can the app see Assets at all? Returns workspace + schema summary (no writes). */
export async function probeAssets() {
  const ws = await getWorkspaceId();
  if (!ws) return { available: false };
  const schemas = await assets.listSchemas(ws);
  return {
    available: true,
    workspaceId: ws,
    schemas: (schemas?.values ?? []).map((s) => ({ id: s.id, key: s.objectSchemaKey, name: s.name, objectCount: s.objectCount })),
  };
}

/**
 * Ensure the Precedent schema, its object types and their attributes exist.
 * Returns ids the per-object steps need: { ws, schemaId, types: { Site: { id, attrs: { name: id } }, ... } }.
 */
export async function ensureAssetsModel() {
  const ws = await getWorkspaceId(AS_USER);
  if (!ws) throw new Error('Assets is not available on this site');

  const schemas = await assetsAsUser.listSchemas(ws);
  let schema = (schemas?.values ?? []).find((s) => s.objectSchemaKey === SCHEMA_KEY);
  const created = { schema: false, types: [], attributes: 0 };
  if (!schema) {
    schema = await assetsAsUser.createSchema(ws, {
      name: SCHEMA_NAME,
      objectSchemaKey: SCHEMA_KEY,
      description: 'Sites and equipment managed by Precedent',
    });
    created.schema = true;
  }

  const icons = await assetsAsUser.icons(ws);
  const iconId = (name) => (icons.find((i) => i.name === name) ?? icons[0]).id;

  const existingTypes = await assetsAsUser.listTypes(ws, schema.id);
  const types = {};
  for (const def of TYPE_DEFS) {
    let type = existingTypes.find((t) => t.name === def.name);
    if (!type) {
      type = await assetsAsUser.createType(ws, { name: def.name, description: def.description, iconId: iconId(def.icon), objectSchemaId: String(schema.id) });
      created.types.push(def.name);
    }
    const attrs = await assetsAsUser.listAttributes(ws, type.id);
    const byName = Object.fromEntries(attrs.map((a) => [a.name, a.id]));
    for (const [name, defaultTypeId] of def.attributes) {
      if (!byName[name]) {
        const attr = await assetsAsUser.createAttribute(ws, type.id, { name, type: 0, defaultTypeId });
        byName[name] = attr.id;
        created.attributes += 1;
      }
    }
    types[def.name] = { id: type.id, attrs: byName };
  }
  const model = { ws, schemaId: schema.id, schemaKey: SCHEMA_KEY, types };
  await kvs.set(MODEL_CACHE_KEY, model);
  return { ...model, created };
}

/** Cached model ids, or (re)build them if missing. */
async function getModel() {
  return (await kvs.get(MODEL_CACHE_KEY)) ?? ensureAssetsModel();
}

const aqlString = (v) => `"${String(v).replace(/["\\]/g, '\\$&')}"`;

/** Find an object of a type by Name, or create it with the given attribute values. */
async function upsertByName(model, typeName, name, values) {
  const type = model.types[typeName];
  const found = await assetsAsUser.aql(model.ws, `objectTypeId = ${type.id} AND Name = ${aqlString(name)}`);
  const existing = found?.values?.[0];
  if (existing) return { id: existing.id, objectKey: existing.objectKey, name, created: false };

  const attributes = [{ objectTypeAttributeId: type.attrs.Name, objectAttributeValues: [{ value: name }] }];
  for (const [attrName, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    const id = type.attrs[attrName];
    if (!id) throw new Error(`Attribute ${attrName} missing on ${typeName}`);
    attributes.push({ objectTypeAttributeId: id, objectAttributeValues: [{ value: String(value) }] });
  }
  const obj = await assetsAsUser.createObject(model.ws, { objectTypeId: String(type.id), attributes });
  return { id: obj.id, objectKey: obj.objectKey, name, created: true };
}

/**
 * Equipment of an Assets Site, read as the app (works with no user, e.g. in the background check).
 * Returns [{ tag, objectKey, category, level, serves, manufacturer, model, specs, sourceSheet, ifcGuid }].
 * Falls back to the bundled EXB seed when Assets or the Precedent schema isn't available, flagged `source: 'seed'`.
 */
export async function listSiteEquipment(siteName) {
  const fromSeed = () => ({
    source: 'seed',
    equipment: siteName === seed.building.name
      ? seed.equipment.map((e) => ({ tag: e.tag, objectKey: null, category: e.category, level: e.level, serves: e.serves, manufacturer: e.manufacturer, model: e.model, specs: e.specs, sourceSheet: e.sourceSheet, ifcGuid: e.ifcGuid }))
      : [],
  });
  const model = await kvs.get(MODEL_CACHE_KEY);
  if (!model) return fromSeed();
  try {
    const type = model.types.Equipment;
    const nameById = Object.fromEntries(Object.entries(type.attrs).map(([name, id]) => [String(id), name]));
    const res = await api.asApp().requestJira(route`/jsm/assets/workspace/${model.ws}/v1/object/aql?maxResults=${200}`, json({
      qlQuery: `objectTypeId = ${type.id} AND Site = ${aqlString(siteName)}`,
    }));
    const body = await readJson(res, 'List site equipment');
    const equipment = (body?.values ?? []).map((obj) => {
      const v = {};
      for (const a of obj.attributes ?? []) {
        const name = nameById[String(a.objectTypeAttributeId)];
        if (name) v[name] = a.objectAttributeValues?.[0]?.value ?? a.objectAttributeValues?.[0]?.displayValue ?? '';
      }
      return {
        tag: obj.label ?? v.Name, objectKey: obj.objectKey, category: v.Category ?? '', level: v.Level ?? '', serves: v.Serves ?? '',
        manufacturer: v.Manufacturer ?? '', model: v.Model ?? '', specs: v.Specs ?? '', sourceSheet: v['Source sheet'] ?? '', ifcGuid: v['IFC GlobalId'] ?? '',
      };
    }).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
    return { source: 'assets', schemaId: model.schemaId, equipment };
  } catch (err) {
    console.error(`Assets equipment read failed, using seed: ${err.message}`);
    return fromSeed();
  }
}

/** The seed's import plan, so the UI can show progress and call one step at a time. */
export function exbImportPlan() {
  return {
    building: seed.building.name,
    steps: [
      { kind: 'site', ref: seed.building.code },
      ...seed.levels.map((l) => ({ kind: 'level', ref: l.code })),
      ...seed.equipment.map((e) => ({ kind: 'equipment', ref: e.tag })),
    ],
  };
}

/** Import one seed item (site, level or equipment) into Assets. Idempotent. */
export async function importExbStep({ kind, ref }) {
  const model = await getModel();
  const b = seed.building;
  if (kind === 'site') {
    return upsertByName(model, 'Site', b.name, { Code: b.code, Description: b.description });
  }
  if (kind === 'level') {
    const l = seed.levels.find((x) => x.code === ref);
    if (!l) throw new Error(`Unknown level ${ref}`);
    return upsertByName(model, 'Level', `${b.code} ${l.name}`, {
      Code: l.code, Site: b.name, 'Elevation (ft)': l.elevationFt, 'Height (ft)': l.heightFt,
    });
  }
  if (kind === 'equipment') {
    const e = seed.equipment.find((x) => x.tag === ref);
    if (!e) throw new Error(`Unknown equipment ${ref}`);
    return upsertByName(model, 'Equipment', e.tag, {
      Site: b.name, Level: e.level, Category: e.category, System: e.system, Serves: e.serves,
      Manufacturer: e.manufacturer, Model: e.model, Specs: e.specs, 'Source sheet': e.sourceSheet, Grid: e.grid,
      'IFC GlobalId': e.ifcGuid, 'IFC class': e.ifcClass,
    });
  }
  throw new Error(`Unknown step kind ${kind}`);
}
