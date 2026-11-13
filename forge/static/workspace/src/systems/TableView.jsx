import { useMemo, useState } from 'react';
import { LINK_TYPES, NODE_TYPES, SYSTEMS, formatValue, systemOfLink, systemOfNode } from '../../../../src/graphSchema.js';
import { ProvenanceChip, SystemDot } from './Inspector.jsx';

const linkKey = (l) => `${l.from}|${l.type}|${l.to}`;

/** Spreadsheet view of every component and connection: filter, sort, click to inspect. */
export default function TableView({ graph, selected, onSelect }) {
  const [tab, setTab] = useState('components');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(['name', 1]);
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const degree = useMemo(() => {
    const d = new Map();
    for (const l of graph.links) { d.set(l.from, (d.get(l.from) ?? 0) + 1); d.set(l.to, (d.get(l.to) ?? 0) + 1); }
    return d;
  }, [graph]);
  const needle = q.trim().toLowerCase();

  const rows = useMemo(() => {
    if (tab === 'components') {
      const r = graph.nodes.map((n) => {
        const values = Object.entries(n.attrs ?? {}).filter(([k]) => !['specs', 'serves', 'ratingAssumed', 'ifcGuid', 'sourceSheet', 'level'].includes(k)).slice(0, 4);
        return { n, name: n.name, type: NODE_TYPES[n.type]?.label ?? n.type, system: SYSTEMS[systemOfNode(n)]?.label ?? '', links: degree.get(n.id) ?? 0, values, search: `${n.name} ${n.type} ${values.map(([, f]) => f.value).join(' ')}`.toLowerCase() };
      });
      return r.filter((x) => !needle || x.search.includes(needle));
    }
    return graph.links.filter((l) => l.type !== 'locatedOn').map((l) => {
      const a = nodes.get(l.from);
      const b = nodes.get(l.to);
      return { l, name: a?.name ?? l.from, to: b?.name ?? l.to, type: LINK_TYPES[l.type]?.label ?? l.type, system: SYSTEMS[systemOfLink(l, nodes)]?.label ?? '', search: `${a?.name} ${b?.name} ${l.type}`.toLowerCase() };
    }).filter((x) => !needle || x.search.includes(needle));
  }, [tab, graph, needle, nodes, degree]);

  const sorted = [...rows].sort((a, b) => {
    const [k, dir] = sort;
    const x = a[k] ?? '';
    const y = b[k] ?? '';
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
  });
  const th = (k, label) => <th onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : 1])}>{label}{sort[0] === k ? (sort[1] > 0 ? ' ↑' : ' ↓') : ''}</th>;

  return (
    <div className="sx-table-wrap">
      <div className="sx-table-bar">
        <div className="sx-seg">
          <button type="button" className={tab === 'components' ? 'sx-seg-on' : ''} onClick={() => setTab('components')}>Components {graph.nodes.length}</button>
          <button type="button" className={tab === 'connections' ? 'sx-seg-on' : ''} onClick={() => setTab('connections')}>Connections {graph.links.filter((l) => l.type !== 'locatedOn').length}</button>
        </div>
        <input className="sx-input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
      </div>
      <div className="sx-table-scroll">
        <table className="sx-table">
          <thead>
            {tab === 'components'
              ? <tr>{th('name', 'Tag')}{th('type', 'Type')}{th('system', 'System')}{th('links', 'Links')}<th>Values</th></tr>
              : <tr>{th('name', 'From')}{th('type', 'Connection')}{th('to', 'To')}{th('system', 'System')}<th>Values</th><th>Source</th></tr>}
          </thead>
          <tbody>
            {tab === 'components' && sorted.map((r) => (
              <tr key={r.n.id} className={selected?.id === r.n.id ? 'sx-row-on' : ''} onClick={() => onSelect({ kind: 'node', id: r.n.id }, true)}>
                <td><strong>{r.name}</strong></td>
                <td>{r.type}</td>
                <td>{r.system && <><SystemDot system={systemOfNode(r.n)} /> {r.system}</>}</td>
                <td className={r.links ? '' : 'sx-warn-text'}>{r.links || 'none'}</td>
                <td className="sx-cell-values">{r.values.map(([k, f]) => <span key={k} className="sx-cellval">{formatValue(k, f.value)} <ProvenanceChip fact={f} /></span>)}</td>
              </tr>
            ))}
            {tab === 'connections' && sorted.map((r) => (
              <tr key={linkKey(r.l)} className={selected?.key === linkKey(r.l) ? 'sx-row-on' : ''} onClick={() => onSelect({ kind: 'link', key: linkKey(r.l) }, true)}>
                <td><strong>{r.name}</strong></td>
                <td className="sx-muted">{r.type}</td>
                <td><strong>{r.to}</strong></td>
                <td><SystemDot system={systemOfLink(r.l, nodes)} /> {r.system}</td>
                <td className="sx-cell-values">{Object.entries(r.l.attrs ?? {}).map(([k, f]) => <span key={k} className="sx-cellval">{formatValue(k, f.value)}</span>)}</td>
                <td><ProvenanceChip fact={r.l} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="sx-empty-note" style={{ padding: 24 }}>Nothing matches.</div>}
      </div>
    </div>
  );
}
