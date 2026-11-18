/**
 * Onboarding import: turn rows pasted from a spreadsheet (a valve schedule, a panel schedule, a riser list)
 * into graph edits. Pure; tested in test/graphImport.test.mjs. docs/ARCHITECTURE.md §6.8.
 *
 * Two shapes, detected from the header row:
 *  - Connections:  From | To | Connection? | System? | Size? | Material? | From type? | To type?
 *  - Components:   Tag (or Name) | Type? | System? | any other column becomes a value (e.g. "Rating A", "Size in")
 * Components named in a connection that don't exist yet are created, their type guessed from the tag
 * (V-12 → Valve, P-2 → Pump, PNL-H1 → Panel…) unless a type column says otherwise.
 */
import { LINK_TYPES, NODE_TYPES, SYSTEMS } from './graphSchema.js';
import { newNodeId } from './graphEdit.js';

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Split pasted text into rows of cells (tabs from Excel/Sheets, else commas with simple quoting). */
export function parseTable(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const tab = lines[0].includes('\t');
  const splitCsv = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  return lines.map((l) => (tab ? l.split('\t') : splitCsv(l)).map((c) => c.trim()));
}

/** Guess a component type from its tag. */
export function guessType(tag) {
  const t = String(tag ?? '').toUpperCase();
  const rules = [
    [/^(MSB|SWBD|SB)\b|SWITCHBOARD/, 'Switchboard'],
    [/^(PNL|PANEL|RDP|LP|HP|DP|MDP)\b|PANEL/, 'Panel'],
    [/^(CB|BKR|BRK)\b|BREAKER/, 'Breaker'],
    [/^(DS|DISC)\b|DISCONNECT/, 'Disconnect'],
    [/^(XFMR|TX|T)\b|TRANSFORMER/, 'Transformer'],
    [/^(GEN|EG)\b|GENERATOR/, 'Generator'],
    [/^ATS\b/, 'ATS'],
    [/^(UTIL|SERVICE)\b|UTILITY/, 'Utility'],
    [/^(CV)\b|CHECK VALVE/, 'CheckValve'],
    [/^(V|BV|GV|BFV|IV|SOV|PRV|BAL|CBV)\b|VALVE/, 'Valve'],
    [/^(D|FD|SD|MD)\b|DAMPER/, 'Damper'],
    [/^(P|CHWP|HWP|CWP|DP)\b|PUMP/, 'Pump'],
    [/^(TK|ET|TANK)\b|TANK/, 'Tank'],
    [/^(M|WM|GM|FM)\b|METER/, 'Meter'],
    [/^(TS|PS|FS|SEN)\b|SENSOR/, 'Sensor'],
    [/^(TEE|J|JCT)\b/, 'Junction'],
  ];
  const head = t.split(/[-_ ]/)[0];
  for (const [re, type] of rules) if (re.test(head) || re.test(t)) return type;
  return 'Equipment';
}

const TYPE_BY_NAME = new Map(Object.entries(NODE_TYPES).flatMap(([k, v]) => [[norm(k), k], [norm(v.label), k]]));
const SYSTEM_BY_NAME = new Map(Object.entries(SYSTEMS).flatMap(([k, v]) => [[norm(k), k], [norm(v.label), k], [norm(v.short), k]]));
const LINK_BY_NAME = new Map([
  ...Object.entries(LINK_TYPES).flatMap(([k, v]) => [[norm(k), k], [norm(v.label), k], [norm(v.verb), k]]),
  ['pipe', 'flowsTo'], ['duct', 'flowsTo'], ['flow', 'flowsTo'], ['power', 'feeds'], ['feed', 'feeds'], ['supplies', 'flowsTo'],
]);

export const typeFromText = (s) => TYPE_BY_NAME.get(norm(s)) ?? null;
export const systemFromText = (s) => SYSTEM_BY_NAME.get(norm(s)) ?? (norm(s) ? 'other' : null);
export const linkTypeFromText = (s) => LINK_BY_NAME.get(norm(s)) ?? null;

/** "Rating (A)" / "rating a" / "Size in" → attribute names the schema knows, else a camelCase name. */
function attrFromHeader(h) {
  const n = norm(h);
  const known = {
    'rating a': 'ratingA', rating: 'ratingA', amps: 'ratingA', 'bus a': 'busA', bus: 'busA', voltage: 'voltage', volts: 'voltage',
    size: 'sizeIn', 'size in': 'sizeIn', diameter: 'sizeIn', material: 'material', position: 'position', 'normal position': 'normalPosition',
    'valve type': 'valveType', 'flow gpm': 'flowGpm', flow: 'flowGpm', gpm: 'flowGpm', 'head ft': 'headFt', hp: 'hp', kva: 'kva', kw: 'kw',
    manufacturer: 'manufacturer', make: 'manufacturer', model: 'model', serial: 'serial', location: 'location', room: 'location',
    category: 'category', notes: 'notes', length: 'lengthFt', 'length ft': 'lengthFt', poles: 'poles', 'weight lb': 'weightLb',
  };
  if (known[n]) return known[n];
  const camel = n.split(' ').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  return /^[a-z][A-Za-z0-9]{0,40}$/.test(camel) ? camel : null;
}

/**
 * Build edit ops from pasted rows against the current graph. Returns { ops, summary, warnings }.
 * Existing components are matched by name (case-insensitive) or id; nothing is ever deleted by an import.
 */
export function importOps(graph, text) {
  const rows = parseTable(text);
  const warnings = [];
  if (rows.length < 2) return { ops: [], summary: { components: 0, connections: 0, updated: 0 }, warnings: ['Paste a header row and at least one data row.'] };
  const header = rows[0].map(norm);
  const col = (...names) => header.findIndex((h) => names.includes(h));

  const byName = new Map();
  const ids = new Map();
  for (const n of graph?.nodes ?? []) {
    byName.set(n.name.toLowerCase(), n.id);
    ids.set(n.id, n);
  }
  // Also match by tag in the id ("MSB" → switchboard:MSB named "Main switchboard MSB"), without overriding names.
  for (const n of graph?.nodes ?? []) {
    const tag = n.id.split(':')[1]?.toLowerCase();
    if (tag && !byName.has(tag)) byName.set(tag, n.id);
  }
  const ops = [];
  const summary = { components: 0, connections: 0, updated: 0 };

  const ensure = (name, typeHint, system) => {
    const key = name.toLowerCase();
    if (byName.has(key)) return byName.get(key);
    const type = typeHint || guessType(name);
    const id = newNodeId(ids, type, name);
    ids.set(id, true);
    byName.set(key, id);
    ops.push({ op: 'addNode', note: 'Imported from a pasted table', node: { id, type, name, ...(system && system !== 'other' ? { system } : {}) } });
    summary.components += 1;
    return id;
  };

  const iFrom = col('from', 'source', 'upstream', 'fed from');
  const iTo = col('to', 'target', 'downstream', 'feeds', 'serves');
  if (iFrom >= 0 && iTo >= 0) {
    const iType = col('connection', 'link', 'relation', 'type', 'connection type');
    const iSys = col('system', 'service', 'medium');
    const iSize = col('size', 'size in', 'diameter', 'pipe size');
    const iMat = col('material', 'pipe material');
    const iLen = col('length', 'length ft');
    const iFromType = col('from type');
    const iToType = col('to type');
    const seen = new Set((graph?.links ?? []).map((l) => `${l.from}|${l.type}|${l.to}`));
    rows.slice(1).forEach((r, i) => {
      const from = r[iFrom];
      const to = r[iTo];
      if (!from || !to) { warnings.push(`Row ${i + 2}: needs both From and To.`); return; }
      const system = iSys >= 0 ? systemFromText(r[iSys]) : null;
      const explicit = iType >= 0 ? linkTypeFromText(r[iType]) : null;
      if (iType >= 0 && r[iType] && !explicit) warnings.push(`Row ${i + 2}: unknown connection "${r[iType]}", used ${system === 'electrical' ? 'feeds' : 'pipe'}.`);
      const type = explicit ?? (system === 'electrical' ? 'feeds' : 'flowsTo');
      const a = ensure(from, iFromType >= 0 ? typeFromText(r[iFromType]) : null, system);
      const b = ensure(to, iToType >= 0 ? typeFromText(r[iToType]) : null, system);
      if (a === b) { warnings.push(`Row ${i + 2}: ${from} can't connect to itself.`); return; }
      const key = `${a}|${type}|${b}`;
      if (seen.has(key)) { warnings.push(`Row ${i + 2}: ${from} → ${to} is already there.`); return; }
      seen.add(key);
      const attrs = {};
      if (iSize >= 0 && r[iSize]) attrs.sizeIn = r[iSize].replace(/["″]|\bin\b/g, '').trim();
      if (iMat >= 0 && r[iMat]) attrs.material = r[iMat];
      if (iLen >= 0 && r[iLen]) attrs.lengthFt = r[iLen].replace(/ft|'/g, '').trim();
      ops.push({ op: 'addLink', note: 'Imported from a pasted table', link: { from: a, to: b, type, ...(system && system !== 'other' ? { system } : {}), ...(Object.keys(attrs).length ? { attrs } : {}) } });
      summary.connections += 1;
    });
    return { ops, summary, warnings };
  }

  const iTag = col('tag', 'name', 'id', 'equipment', 'component', 'asset');
  if (iTag < 0) return { ops: [], summary, warnings: ['Couldn’t find a From and To column, or a Tag column. Check the header row.'] };
  const iType = col('type', 'component type', 'kind');
  const iSys = col('system', 'service', 'medium');
  const valueCols = header.map((h, i) => ({ i, attr: [iTag, iType, iSys].includes(i) ? null : attrFromHeader(rows[0][i]) })).filter((c) => c.attr);
  rows.slice(1).forEach((r, i) => {
    const name = r[iTag];
    if (!name) { warnings.push(`Row ${i + 2}: no tag.`); return; }
    const system = iSys >= 0 ? systemFromText(r[iSys]) : null;
    const set = {};
    for (const c of valueCols) if (r[c.i]) set[c.attr] = r[c.i];
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      if (Object.keys(set).length || system) {
        ops.push({ op: 'updateNode', id: existing, note: 'Imported from a pasted table', set, ...(system && system !== 'other' ? { system } : {}) });
        summary.updated += 1;
      }
      return;
    }
    const typed = iType >= 0 ? typeFromText(r[iType]) : null;
    if (iType >= 0 && r[iType] && !typed) warnings.push(`Row ${i + 2}: unknown type "${r[iType]}", guessed from the tag.`);
    const id = ensure(name, typed, system);
    if (Object.keys(set).length) ops[ops.findIndex((o) => o.node?.id === id)].node.attrs = set;
  });
  return { ops, summary, warnings };
}
