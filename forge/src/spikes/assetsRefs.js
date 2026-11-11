/**
 * Spike 7 (docs/ARCHITECTURE.md §7): can Precedent model graph links as Assets reference attributes?
 *
 * As the user (Assets admin): ensure two throwaway types in the PREC schema ("Spike Panel", "Spike Feeder"),
 * a reference type "feeds", and a reference attribute "Fed from" on Spike Feeder; create SP-1 and SF-1 → SP-1.
 * As the app: try to create SF-2 (can accept-time closeouts write Assets as the app?), read SF-1 by AQL,
 * and time a reference-walking AQL query.
 *
 * Never throws: every step reports { name, ok, detail } so the Diagnostics panel shows exactly what happened.
 */
import { route } from '@forge/api';
import { AS_APP, AS_USER, SCHEMA_KEY, assetsClient, getWorkspaceId, json, readJson } from '../assets';

const PANEL_TYPE = 'Spike Panel';
const FEEDER_TYPE = 'Spike Feeder';
const REF_TYPE = 'feeds';
const REF_ATTR = 'Fed from';
const OBJECT_REFERENCE = 1; // Assets attribute `type` for an object reference (assumption under test)

/** Assets calls the shared client doesn't cover. */
const extra = (who) => ({
  listRefTypes: async (ws, schemaId) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/config/referencetype?objectSchemaId=${String(schemaId)}`), 'List reference types'),
  createRefType: async (ws, body) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/config/referencetype`, json(body)), 'Create reference type'),
  aqlMany: async (ws, qlQuery) => readJson(await who().requestJira(route`/jsm/assets/workspace/${ws}/v1/object/aql?maxResults=${25}`, json({ qlQuery })), 'AQL query'),
});

export async function spikeAssetsRefs() {
  const steps = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: `${detail ?? 'ok'} (${Date.now() - t0} ms)` });
      return true;
    } catch (err) {
      steps.push({ name, ok: false, detail: `${err.message} (${Date.now() - t0} ms)` });
      return false;
    }
  };

  const user = assetsClient(AS_USER);
  const app = assetsClient(AS_APP);
  const userX = extra(AS_USER);
  const appX = extra(AS_APP);
  const s = {};

  const ready = await step('Find workspace + PREC schema (user)', async () => {
    s.ws = await getWorkspaceId(AS_USER);
    if (!s.ws) throw new Error('Assets not available');
    const schemas = await user.listSchemas(s.ws);
    s.schema = (schemas?.values ?? []).find((x) => x.objectSchemaKey === SCHEMA_KEY);
    if (!s.schema) throw new Error('PREC schema missing: run the Assets import first');
    return `workspace ${s.ws}, schema ${s.schema.id}`;
  });
  if (!ready) return { steps };

  await step('Ensure types Spike Panel / Spike Feeder (user)', async () => {
    const icons = await user.icons(s.ws);
    const types = await user.listTypes(s.ws, s.schema.id);
    for (const name of [PANEL_TYPE, FEEDER_TYPE]) {
      let t = types.find((x) => x.name === name);
      if (!t) t = await user.createType(s.ws, { name, description: 'Spike 7 (safe to delete)', iconId: icons[0].id, objectSchemaId: String(s.schema.id) });
      s[name] = { id: t.id };
      const attrs = await user.listAttributes(s.ws, t.id);
      s[name].attrs = Object.fromEntries(attrs.map((a) => [a.name, a]));
    }
    return `panel type ${s[PANEL_TYPE].id}, feeder type ${s[FEEDER_TYPE].id}`;
  });

  // 2026-11-11 first run: GET config/referencetype → "Authentication Required" (51 ms), i.e. the config API
  // isn't reachable with the app's scopes. Record it, then try the attribute without our own reference type.
  await step(`List / create reference type "${REF_TYPE}" (user)`, async () => {
    const list = await userX.listRefTypes(s.ws, s.schema.id);
    s.refTypes = list ?? [];
    let rt = s.refTypes.find((x) => x.name === REF_TYPE);
    if (!rt) rt = await userX.createRefType(s.ws, { name: REF_TYPE, description: 'Spike 7', objectSchemaId: String(s.schema.id) });
    s.refType = rt;
    return `reference type id ${rt.id}; available: ${s.refTypes.map((r) => `${r.id}=${r.name}`).join(', ')}`;
  });

  // Run 2 (2026-11-11): no additionalValue → 400; ids 1–8 → "ReferenceType invalid". Reference type ids are
  // per workspace, so learn real ones from reference attributes that already exist anywhere on the site.
  await step('Discover reference types from existing reference attributes (user)', async () => {
    const found = new Map();
    const schemas = (await user.listSchemas(s.ws))?.values ?? [];
    for (const schema of schemas.slice(0, 10)) { // capped: stay well under the 25 s resolver limit
      const types = await user.listTypes(s.ws, schema.id);
      for (const t of types.slice(0, 30)) {
        for (const a of await user.listAttributes(s.ws, t.id)) {
          if (a.referenceType?.id && !found.has(String(a.referenceType.id))) {
            found.set(String(a.referenceType.id), `${a.referenceType.name} (e.g. ${schema.objectSchemaKey}/${t.name}.${a.name})`);
          }
        }
      }
      if (found.size >= 5) break;
    }
    s.discoveredRefTypes = [...found.keys()];
    if (!found.size) throw new Error(`no reference attributes in ${schemas.length} schemas`);
    return [...found.entries()].map(([id, d]) => `${id}=${d}`).join('; ');
  });

  await step(`Ensure reference attribute "${REF_ATTR}" (user)`, async () => {
    if (!s[FEEDER_TYPE] || !s[PANEL_TYPE]) throw new Error('skipped: spike types missing');
    const existing = s[FEEDER_TYPE].attrs[REF_ATTR];
    if (existing) {
      s.refAttr = existing;
      return `exists: id ${existing.id}, type ${existing.type}, referenceObjectTypeId ${existing.referenceObjectTypeId}, referenceType ${existing.referenceType?.name ?? '?'}`;
    }
    // Candidates for the reference type: ours if we have it, none at all, then low ids (built-in types are usually 1..n).
    const candidates = [s.refType?.id, ...(s.discoveredRefTypes ?? [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    if (!candidates.length) throw new Error('skipped: no reference type id known');
    const tried = [];
    for (const additionalValue of candidates) {
      const body = { name: REF_ATTR, type: OBJECT_REFERENCE, typeValue: String(s[PANEL_TYPE].id) };
      if (additionalValue !== undefined) body.additionalValue = String(additionalValue);
      try {
        const created = await user.createAttribute(s.ws, s[FEEDER_TYPE].id, body);
        s.refAttr = created;
        return `created with additionalValue=${additionalValue ?? 'none'} (after ${tried.length} failed tries): id ${created.id}, type ${created.type}, referenceType ${created.referenceType?.id}=${created.referenceType?.name}`;
      } catch (err) {
        tried.push(`${additionalValue ?? 'none'}: ${err.message.slice(0, 120)}`);
      }
    }
    throw new Error(`every candidate failed → ${tried.join(' | ')}`);
  });

  const upsert = async (client, typeName, name, extraAttrs = []) => {
    const t = s[typeName];
    const found = await client.aql(s.ws, `objectTypeId = ${t.id} AND Name = "${name}"`);
    if (found?.values?.[0]) return { obj: found.values[0], created: false };
    const nameAttr = t.attrs.Name ?? (await user.listAttributes(s.ws, t.id)).find((a) => a.name === 'Name');
    const obj = await client.createObject(s.ws, {
      objectTypeId: String(t.id),
      attributes: [{ objectTypeAttributeId: nameAttr.id, objectAttributeValues: [{ value: name }] }, ...extraAttrs],
    });
    return { obj, created: true };
  };

  await step('Create SP-1 and SF-1 → SP-1 (user)', async () => {
    if (!s.refAttr) throw new Error('skipped: no reference attribute');
    const panel = await upsert(user, PANEL_TYPE, 'SP-1');
    s.panel = panel.obj;
    const feeder = await upsert(user, FEEDER_TYPE, 'SF-1', [
      { objectTypeAttributeId: s.refAttr.id, objectAttributeValues: [{ value: panel.obj.objectKey }] },
    ]);
    s.feeder = feeder.obj;
    return `SP-1 ${panel.obj.objectKey}${panel.created ? ' (new)' : ''}, SF-1 ${feeder.obj.objectKey}${feeder.created ? ' (new)' : ''}`;
  });

  await step('App account creates SF-2 (app write test)', async () => {
    if (!s[FEEDER_TYPE]) throw new Error('skipped: spike types missing');
    const { obj, created } = await upsert(app, FEEDER_TYPE, 'SF-2', s.panel && s.refAttr ? [
      { objectTypeAttributeId: s.refAttr.id, objectAttributeValues: [{ value: s.panel.objectKey }] },
    ] : []);
    return `app CAN write objects: SF-2 ${obj.objectKey}${created ? ' (new)' : ' (already existed)'}`;
  });

  await step('Read SF-1 reference by AQL (app)', async () => {
    if (!s.feeder) throw new Error('skipped: SF-1 not created');
    const res = await appX.aqlMany(s.ws, `objectTypeId = ${s[FEEDER_TYPE].id} AND "${REF_ATTR}" = "SP-1"`);
    const names = (res?.values ?? []).map((o) => o.label);
    if (!names.includes('SF-1')) throw new Error(`SF-1 not found; got [${names.join(', ')}]`);
    return `feeders fed from SP-1: ${names.join(', ')}`;
  });

  await step('Walk: objects referencing SP-1 via inboundReferences (app)', async () => {
    const res = await appX.aqlMany(s.ws, `object HAVING outboundReferences(Name = "SP-1")`);
    const names = (res?.values ?? []).map((o) => o.label);
    return `${names.length} objects reference SP-1: ${names.join(', ')}`;
  });

  return { steps };
}
