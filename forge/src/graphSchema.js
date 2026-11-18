/**
 * The building graph vocabulary: systems, component types, connection types and their attributes.
 * Pure (no Forge imports). Shared by the backend and the Custom UI (imported by relative path), so the editor,
 * the impact engine and the agent all speak the same language. docs/ARCHITECTURE.md §6.8.
 */

/** Building systems. `colour` is the overlay colour in the 3D model and the schematic (works on light and dark). */
export const SYSTEMS = {
  electrical: { label: 'Electrical power', short: 'Power', colour: '#F5CD47' },
  chw: { label: 'Chilled water', short: 'CHW', colour: '#2898BD' },
  hhw: { label: 'Heating hot water', short: 'HHW', colour: '#F38A3F' },
  cw: { label: 'Condenser water', short: 'CW', colour: '#6CC3E0' },
  refrigerant: { label: 'Refrigerant', short: 'Refrig', colour: '#9F8FEF' },
  dcw: { label: 'Domestic cold water', short: 'DCW', colour: '#4BCE97' },
  dhw: { label: 'Domestic hot water', short: 'DHW', colour: '#F87168' },
  gas: { label: 'Natural gas', short: 'Gas', colour: '#94C748' },
  fire: { label: 'Fire protection', short: 'Fire', colour: '#E774BB' },
  air: { label: 'Air (ducts)', short: 'Air', colour: '#9DD9EE' },
  structural: { label: 'Structure', short: 'Struct', colour: '#8C9BAB' },
  other: { label: 'Served areas & other', short: 'Other', colour: '#B3B9C4' },
};

export const systemColour = (key) => SYSTEMS[key]?.colour ?? SYSTEMS.other.colour;

/** Attribute templates. `unit` is shown next to the value; `options` makes a picker. */
const A = {
  sizeIn: { label: 'Size', unit: 'in', kind: 'number' },
  material: { label: 'Material', kind: 'text' },
  position: { label: 'Position now', kind: 'choice' },
  normalPosition: { label: 'Normal position', kind: 'choice' },
  ratingA: { label: 'Rating', unit: 'A', kind: 'number' },
  busA: { label: 'Bus', unit: 'A', kind: 'number' },
  voltage: { label: 'Voltage', kind: 'text' },
  poles: { label: 'Poles', kind: 'number' },
  flowGpm: { label: 'Flow', unit: 'gpm', kind: 'number' },
  headFt: { label: 'Head', unit: 'ft', kind: 'number' },
  hp: { label: 'Motor', unit: 'hp', kind: 'number' },
  kva: { label: 'Rating', unit: 'kVA', kind: 'number' },
  kw: { label: 'Rating', unit: 'kW', kind: 'number' },
  capacityGal: { label: 'Capacity', unit: 'gal', kind: 'number' },
  setpoint: { label: 'Setpoint', kind: 'text' },
  manufacturer: { label: 'Manufacturer', kind: 'text' },
  model: { label: 'Model', kind: 'text' },
  serial: { label: 'Serial', kind: 'text' },
  location: { label: 'Location', kind: 'text' },
  loadLimitLb: { label: 'Load limit', unit: 'lb', kind: 'number' },
  weightLb: { label: 'Weight', unit: 'lb', kind: 'number' },
  category: { label: 'Category', kind: 'text' },
  notes: { label: 'Notes', kind: 'text' },
};

const VALVE_POSITIONS = ['open', 'closed', 'throttled'];
const SWITCH_POSITIONS = ['closed', 'open']; // electrical: closed = energised, open = off

/**
 * Component (node) types. `isolation` describes the devices that can stop flow, and which position does it:
 * the impact engine and isolation plans use it. `shape` picks the glyph in the schematic.
 */
export const NODE_TYPES = {
  Equipment: { label: 'Equipment', shape: 'box', attrs: ['category', 'manufacturer', 'model', 'serial', 'weightLb', 'location'] },
  // Electrical
  Utility: { label: 'Utility service', shape: 'source', system: 'electrical', attrs: ['voltage', 'kva'] },
  Generator: { label: 'Generator', shape: 'source', system: 'electrical', attrs: ['kw', 'voltage', 'manufacturer'] },
  Transformer: { label: 'Transformer', shape: 'circle', system: 'electrical', attrs: ['kva', 'voltage'] },
  ATS: { label: 'Transfer switch', shape: 'switch', system: 'electrical', attrs: ['ratingA', 'voltage'], isolation: { attr: 'position', options: SWITCH_POSITIONS, blocks: 'open' } },
  Switchboard: { label: 'Switchboard', shape: 'panel', system: 'electrical', attrs: ['busA', 'voltage', 'location'] },
  Panel: { label: 'Panel', shape: 'panel', system: 'electrical', attrs: ['busA', 'voltage', 'location'] },
  Breaker: { label: 'Breaker', shape: 'switch', system: 'electrical', attrs: ['ratingA', 'poles'], isolation: { attr: 'position', options: SWITCH_POSITIONS, blocks: 'open' } },
  Feeder: { label: 'Feeder (cable)', shape: 'line', system: 'electrical', attrs: ['sets', 'size', 'material'] },
  Disconnect: { label: 'Disconnect', shape: 'switch', system: 'electrical', attrs: ['ratingA', 'type'], isolation: { attr: 'position', options: SWITCH_POSITIONS, blocks: 'open' } },
  // Piping and air
  Pump: { label: 'Pump', shape: 'circle', attrs: ['flowGpm', 'headFt', 'hp', 'manufacturer'] },
  Valve: { label: 'Valve', shape: 'valve', attrs: ['sizeIn', 'valveType', 'normalPosition', 'position'], isolation: { attr: 'position', options: VALVE_POSITIONS, blocks: 'closed' } },
  CheckValve: { label: 'Check valve', shape: 'valve', attrs: ['sizeIn'] },
  Damper: { label: 'Damper', shape: 'valve', system: 'air', attrs: ['sizeIn', 'normalPosition', 'position'], isolation: { attr: 'position', options: VALVE_POSITIONS, blocks: 'closed' } },
  Junction: { label: 'Tee / junction', shape: 'dot', attrs: ['sizeIn'] },
  Tank: { label: 'Tank', shape: 'box', attrs: ['capacityGal', 'material'] },
  Meter: { label: 'Meter', shape: 'circle', attrs: ['sizeIn', 'serial'] },
  Sensor: { label: 'Sensor', shape: 'dot', attrs: ['setpoint', 'model'] },
  PipeLoop: { label: 'Pipe loop', shape: 'loop', attrs: ['medium'] },
  LineSet: { label: 'Line set', shape: 'line', system: 'refrigerant', attrs: ['refrigerant'] },
  // Places and structure
  ServedArea: { label: 'Served area', shape: 'area', attrs: ['location'] },
  Level: { label: 'Level', shape: 'area', attrs: ['elevationFt', 'heightFt'] },
  Curb: { label: 'Curb', shape: 'box', system: 'structural', attrs: ['loadLimitLb'] },
  RoofZone: { label: 'Roof zone', shape: 'area', system: 'structural', attrs: ['loadLimitLb'] },
};

/** Extra attribute templates referenced above but not in A. */
Object.assign(A, {
  valveType: { label: 'Valve type', kind: 'choice', options: ['ball', 'butterfly', 'gate', 'globe', 'check', 'PRV', 'balancing', 'control'] },
  type: { label: 'Type', kind: 'text' },
  sets: { label: 'Parallel sets', kind: 'number' },
  size: { label: 'Conductor size', kind: 'text' },
  medium: { label: 'Medium', kind: 'text' },
  refrigerant: { label: 'Refrigerant', kind: 'text' },
  elevationFt: { label: 'Elevation', unit: 'ft', kind: 'number' },
  heightFt: { label: 'Height', unit: 'ft', kind: 'number' },
  lengthFt: { label: 'Length', unit: 'ft', kind: 'number' },
  insulation: { label: 'Insulation', kind: 'text' },
  mopA: { label: 'MOP', unit: 'A', kind: 'number' },
  mcaA: { label: 'MCA', unit: 'A', kind: 'number' },
  serves: { label: 'Serves', kind: 'text' },
  specs: { label: 'Specifications', kind: 'text' },
  level: { label: 'Level', kind: 'text' },
  ratingAssumed: { label: 'Rating assumed', kind: 'text' },
});
export const ATTRS = A;

/** Connection (link) types. `directed` links carry flow from `from` to `to` (used by impact and tracing). */
export const LINK_TYPES = {
  feeds: { label: 'Feeds (power)', verb: 'feeds', directed: true, system: 'electrical' },
  flowsTo: { label: 'Pipe / duct', verb: 'flows to', directed: true, attrs: ['sizeIn', 'material', 'lengthFt', 'insulation'] },
  serves: { label: 'Serves', verb: 'serves', directed: true },
  protects: { label: 'Protects', verb: 'protects', directed: false, system: 'electrical' },
  connects: { label: 'Connected to', verb: 'connects to', directed: false },
  controls: { label: 'Controls', verb: 'controls', directed: false },
  supportedBy: { label: 'Supported by', verb: 'is supported by', directed: false, system: 'structural' },
  locatedOn: { label: 'Located on', verb: 'is on', directed: false },
};

/** Link types drawn in the 3D/schematic overlays (locatedOn is a filing relation, not a connection). */
export const DRAWN_LINK_TYPES = ['feeds', 'flowsTo', 'serves', 'connects', 'controls', 'supportedBy', 'protects'];

/** Provenance values. `as-entered` = typed in by a person in the editor (who and when are recorded). */
export const PROVENANCE = {
  'as-built': { label: 'As-built', tone: 'success' },
  illustrative: { label: 'Illustrative', tone: 'default' },
  'as-installed': { label: 'As-installed', tone: 'info' },
  'as-entered': { label: 'Entered', tone: 'discovery' },
};

/** Attribute names a node type should offer in the editor (its template plus any it already has). */
export function attrNamesFor(node) {
  const template = NODE_TYPES[node.type]?.attrs ?? [];
  const isolation = NODE_TYPES[node.type]?.isolation;
  const names = [...template, ...Object.keys(node.attrs ?? {})];
  if (isolation && !names.includes(isolation.attr)) names.push(isolation.attr);
  return [...new Set(names)];
}

/** Options for a choice attribute on a given node type (positions depend on valve vs. switch). */
export function attrOptions(type, attr) {
  const iso = NODE_TYPES[type]?.isolation;
  if ((attr === 'position' || attr === 'normalPosition') && iso) return iso.options;
  return A[attr]?.options ?? null;
}

/** Is this device currently stopping flow (closed valve, open breaker)? */
export function blocksFlow(node) {
  const iso = NODE_TYPES[node?.type]?.isolation;
  return Boolean(iso && node.attrs?.[iso.attr]?.value === iso.blocks);
}

export const isIsolationDevice = (node) => Boolean(NODE_TYPES[node?.type]?.isolation);

/** The system a node or link belongs to: explicit, else from its type, else inferred from its neighbours (caller). */
export function systemOfNode(node) {
  if (node.system) return node.system;
  if (NODE_TYPES[node.type]?.system) return NODE_TYPES[node.type].system;
  const medium = String(node.attrs?.medium?.value ?? '').toLowerCase();
  if (medium.includes('heating')) return 'hhw';
  if (medium.includes('chilled')) return 'chw';
  if (medium.includes('condenser')) return 'cw';
  if (medium.includes('domestic hot')) return 'dhw';
  if (medium.includes('domestic')) return 'dcw';
  if (medium.includes('gas')) return 'gas';
  return null;
}

export function systemOfLink(link, nodes) {
  if (link.system) return link.system;
  if (LINK_TYPES[link.type]?.system) return LINK_TYPES[link.type].system;
  const a = nodes?.get(link.from);
  const b = nodes?.get(link.to);
  return (b && systemOfNode(b)) || (a && systemOfNode(a)) || 'other';
}

/** Display a value with its unit ("250 A", "4 in"). */
export function formatValue(attr, value) {
  if (value === null || value === undefined || value === '') return '';
  const unit = A[attr]?.unit;
  const v = typeof value === 'number' ? value.toLocaleString() : String(value);
  return unit ? `${v} ${unit}` : v;
}

export const attrLabel = (attr) => A[attr]?.label ?? attr.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
