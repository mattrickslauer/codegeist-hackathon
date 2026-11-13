/** Pure helpers for adding components (tested in test/layout.test.mjs). */

export const PALETTE = [
  ['Piping', ['Valve', 'Pump', 'CheckValve', 'Junction', 'Tank', 'Meter', 'PipeLoop']],
  ['Electrical', ['Utility', 'Generator', 'Transformer', 'Switchboard', 'Panel', 'Breaker', 'Disconnect', 'ATS']],
  ['Air & controls', ['Damper', 'Sensor']],
  ['General', ['Equipment', 'ServedArea', 'Curb']],
];

const PREFIX = { Valve: 'V', Pump: 'P', CheckValve: 'CV', Junction: 'J', Tank: 'TK', Meter: 'M', Breaker: 'CB', Disconnect: 'DS', Panel: 'PNL', Switchboard: 'MSB', Transformer: 'T', Generator: 'GEN', ATS: 'ATS', Damper: 'D', Sensor: 'TS', Utility: 'UTIL', Equipment: 'EQ', PipeLoop: 'LOOP', Curb: 'CURB' };

/** The next free tag in a series: after V-12 comes V-13 (looks at every name with the same prefix). */
export function nextTag(graph, type, like) {
  const base = like ? like.replace(/\d+(?!.*\d)/, '') : `${PREFIX[type] ?? type.slice(0, 3).toUpperCase()}-`;
  const prefix = base.replace(/[-\s]*$/, '');
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[-\\s]?(\\d+)$`, 'i');
  let max = 0;
  for (const n of graph.nodes) {
    const m = n.name.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const sep = like ? (like.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([-\\s]?)`))?.[1] ?? '-') : '-';
  return type === 'ServedArea' ? '' : `${prefix}${sep}${max + 1}`;
}

/** Sensible connection type between two components. */
export function defaultLinkType(a, b, system) {
  if (b.type === 'ServedArea') return 'serves';
  if (b.type === 'Curb' || b.type === 'RoofZone') return 'supportedBy';
  if (a.type === 'Sensor' || b.type === 'Sensor') return 'controls';
  if (a.type === 'PipeLoop' || b.type === 'PipeLoop' || a.type === 'LineSet' || b.type === 'LineSet') return 'connects';
  const elec = ['Utility', 'Generator', 'Transformer', 'ATS', 'Switchboard', 'Panel', 'Breaker', 'Feeder', 'Disconnect'];
  if (system === 'electrical' || elec.includes(a.type) || elec.includes(b.type)) return 'feeds';
  return 'flowsTo';
}

