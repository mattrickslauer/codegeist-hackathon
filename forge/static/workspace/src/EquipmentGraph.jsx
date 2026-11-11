import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Lozenge, Spinner } from './ui.jsx';

/** Provenance tag shown next to every graph fact (docs/ARCHITECTURE.md §6.7). */
export function ProvenanceTag({ fact }) {
  if (!fact) return null;
  const label = { 'as-built': 'As-built', illustrative: 'Illustrative', 'as-installed': 'As-installed' }[fact.provenance] ?? fact.provenance;
  const tone = { 'as-built': 'success', 'as-installed': 'info' }[fact.provenance] ?? 'default';
  return <span title={fact.source}><Lozenge tone={tone}>{label}</Lozenge></span>;
}

const n = (v) => (typeof v === 'number' ? v.toLocaleString() : v);

/** The one fact that matters most for each node type, as [text, fact]. */
function keyFact(node) {
  const a = node.attrs;
  switch (node.type) {
    case 'Switchboard': return [`${a.voltage?.value}, ${n(a.busA?.value)} A bus`, a.busA];
    case 'Panel': return [`${n(a.busA?.value)} A bus`, a.busA];
    case 'Breaker': return [`${n(a.ratingA?.value)} A${a.ratingAssumed?.value ? ' (rating assumed)' : ''}`, a.ratingA];
    case 'Feeder': return [`${a.sets?.value} × ${a.size?.value} ${a.material?.value}${a.sets?.value > 1 ? ' (parallel)' : ''}`, a.size];
    case 'Disconnect': return [`${n(a.ratingA?.value)} A ${a.type?.value ?? ''}`.trim(), a.ratingA];
    case 'Curb':
    case 'RoofZone': return [`load limit ${n(a.loadLimitLb?.value)} lb`, a.loadLimitLb];
    case 'LineSet': return [`${a.refrigerant?.value}`, a.refrigerant];
    case 'Equipment': return [a.mopA ? `MOP ${a.mopA.value} A, ${a.voltage?.value}` : a.category?.value ?? '', a.mopA ?? a.category];
    default: return ['', null];
  }
}

function NodeRow({ node }) {
  const [text, fact] = keyFact(node);
  return (
    <li style={{ margin: '4px 0' }}>
      <span className="subtlest">{node.type}</span> <strong>{node.name}</strong>
      {text && <> · {text} </>}<ProvenanceTag fact={fact} />
    </li>
  );
}

/** Power chain, panel loading, served areas, connections and support for one piece of equipment. */
export default function EquipmentGraph({ siteId, tag }) {
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRes(null);
    setError(null);
    api.getEquipmentContext(siteId, tag).then(setRes).catch((err) => setError(String(err?.message ?? err)));
  }, [siteId, tag]);

  if (error) return <p className="subtle">{error}</p>;
  if (!res) return <Spinner label="Loading connections…" />;
  if (res.source === 'none') return <p className="subtle">No connection data for this site yet.</p>;

  const c = res.context;
  const weight = c.equipment.attrs.weightLb;
  const curb = c.support.find((s) => s.type === 'Curb');
  const pct = c.panel ? Math.round((100 * c.panel.connectedBreakerA) / c.panel.busA) : null;

  return (
    <div className="card" style={{ padding: 12, marginBottom: 16 }}>
      <h3 className="card-title" style={{ marginTop: 0 }}>Power, from the source</h3>
      {c.powerChain.length ? <ol style={{ paddingLeft: 20, margin: 0 }}>{c.powerChain.map((node) => <NodeRow key={node.id} node={node} />)}</ol>
        : <p className="subtle">No electrical supply recorded.</p>}
      {c.panel && (
        <p className={pct >= 80 ? '' : 'subtle'} style={{ marginBottom: 0 }}>
          {pct >= 80 && <Lozenge tone="danger">Panel near capacity</Lozenge>}{' '}
          {c.panel.name}: {n(c.panel.connectedBreakerA)} A of breakers on a {n(c.panel.busA)} A bus ({pct}%).
          Also on it: {c.panel.siblings.join(', ') || 'nothing else'}. <ProvenanceTag fact={{ provenance: c.panel.provenance, source: 'samples/bim/exb/illustrative.json' }} />
        </p>
      )}

      {c.serves.length > 0 && <><h3 className="card-title">Serves</h3><p style={{ margin: 0 }}>{c.serves.map((s) => s.name).join('; ')}</p></>}

      {c.connects.length > 0 && (
        <>
          <h3 className="card-title">Connected to</h3>
          <ul style={{ paddingLeft: 20, margin: 0 }}>{c.connects.map((node) => <NodeRow key={node.id} node={node} />)}</ul>
          {c.loopMembers.length > 0 && <p className="subtle" style={{ margin: '4px 0 0' }}>Same loop: {c.loopMembers.map((m) => m.name).join(', ')}</p>}
        </>
      )}

      {c.support.length > 0 && (
        <>
          <h3 className="card-title">Supported by</h3>
          <ul style={{ paddingLeft: 20, margin: 0 }}>{c.support.map((node) => <NodeRow key={node.id} node={node} />)}</ul>
          {weight && curb && (
            <p className="subtle" style={{ margin: '4px 0 0' }}>
              Unit weighs {n(weight.value)} lb <ProvenanceTag fact={weight} />: {Math.round((100 * (curb.attrs.loadLimitLb.value - weight.value)) / weight.value)}% spare on its curb.
            </p>
          )}
        </>
      )}
    </div>
  );
}
