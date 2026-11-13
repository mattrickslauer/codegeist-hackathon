import { useEffect, useMemo, useState } from 'react';
import {
  ATTRS, LINK_TYPES, NODE_TYPES, PROVENANCE, SYSTEMS, attrLabel, attrNamesFor, attrOptions, formatValue, isIsolationDevice,
  systemColour, systemOfLink, systemOfNode,
} from '../../../../src/graphSchema.js';
import { Glyph } from './Schematic.jsx';

export function ProvenanceChip({ fact }) {
  if (!fact?.provenance) return null;
  const p = PROVENANCE[fact.provenance] ?? { label: fact.provenance, tone: 'default' };
  const who = fact.enteredAt ? ` · ${new Date(fact.enteredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '';
  return <span className={`sx-prov sx-prov-${p.tone}`} title={`${fact.source ?? ''}${fact.enteredAt ? ` (${fact.enteredAt})` : ''}`}>{p.label}{who}</span>;
}

export function SystemDot({ system, size = 10 }) {
  return <span className="sx-sysdot" style={{ width: size, height: size, background: systemColour(system) }} />;
}

/** One editable value row: click to edit, Enter to save, Esc to cancel. */
function ValueRow({ name, fact, type, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const options = attrOptions(type, name);
  const begin = () => { setDraft(fact?.value ?? ''); setEditing(true); };
  const save = (v = draft) => { setEditing(false); if (String(v) !== String(fact?.value ?? '')) onSave(name, v); };
  return (
    <div className={`sx-value ${fact ? '' : 'sx-value-empty'}`}>
      <span className="sx-value-label">{attrLabel(name)}</span>
      {editing ? (
        options ? (
          <select autoFocus className="sx-input" value={draft} onChange={(e) => save(e.target.value)} onBlur={() => setEditing(false)}>
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <span className="sx-value-edit">
            <input
              autoFocus
              className="sx-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              onBlur={() => save()}
              placeholder={ATTRS[name]?.unit ? `in ${ATTRS[name].unit}` : ''}
            />
          </span>
        )
      ) : (
        <button type="button" className="sx-value-val" onClick={begin} title="Click to edit">
          {fact ? formatValue(name, fact.value) : <span className="sx-muted">add</span>}
        </button>
      )}
      <span className="sx-value-meta">
        {fact && <ProvenanceChip fact={fact} />}
        {fact && onRemove && <button type="button" className="sx-x" title="Clear value" onClick={() => onRemove(name)}>×</button>}
      </span>
    </div>
  );
}

function AddValue({ existing, onAdd }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const known = Object.keys(ATTRS).filter((k) => !existing.includes(k));
  const attr = known.find((k) => attrLabel(k).toLowerCase() === name.trim().toLowerCase()) ?? name.trim().replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
  return (
    <form className="sx-addvalue" onSubmit={(e) => { e.preventDefault(); if (attr && value) { onAdd(attr, value); setName(''); setValue(''); } }}>
      <input className="sx-input" list="sx-attr-names" placeholder="New value, e.g. Setpoint" value={name} onChange={(e) => setName(e.target.value)} />
      <datalist id="sx-attr-names">{known.map((k) => <option key={k} value={attrLabel(k)} />)}</datalist>
      <input className="sx-input" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="sx-btn sx-btn-ghost" disabled={!attr || !value}>Add</button>
    </form>
  );
}

function ConnectionRow({ link, other, dir, nodes, onSelectLink, onSelectNode }) {
  const sys = systemOfLink(link, nodes);
  const verb = LINK_TYPES[link.type]?.verb ?? link.type;
  const size = link.attrs?.sizeIn?.value;
  return (
    <div className="sx-conn" onClick={() => onSelectLink(link)}>
      <SystemDot system={sys} />
      <span className="sx-conn-dir">{dir === 'in' ? '←' : '→'}</span>
      <span className="sx-conn-text">
        <span className="sx-muted">{dir === 'in' ? `${verb} this` : verb}</span>{' '}
        <a onClick={(e) => { e.stopPropagation(); onSelectNode(other.id); }}>{other.name}</a>
        {size ? <span className="sx-muted"> · {size} in</span> : null}
      </span>
    </div>
  );
}

/** Inspector for a component. */
export function NodeInspector({ graph, node, onEdit, onSelect, actions, modelTags }) {
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const [name, setName] = useState(node.name);
  useEffect(() => setName(node.name), [node.id, node.name]);
  const names = attrNamesFor(node);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [node.id]);
  // Filled values first; empty template fields are offered a few at a time so the panel stays calm.
  const editable = names.filter((k) => k !== NODE_TYPES[node.type]?.isolation?.attr);
  const filled = editable.filter((k) => node.attrs?.[k]);
  const empty = editable.filter((k) => !node.attrs?.[k]);
  const shownNames = showAll ? editable : [...filled, ...empty.slice(0, Math.max(0, 3 - filled.length))];
  const hiddenEmpty = editable.length - shownNames.length;
  const ins = graph.links.filter((l) => l.to === node.id && l.type !== 'locatedOn');
  const outs = graph.links.filter((l) => l.from === node.id && l.type !== 'locatedOn');
  const sys = systemOfNode(node);
  const t = NODE_TYPES[node.type];
  const iso = t?.isolation;
  const recorded = iso ? node.attrs?.[iso.attr]?.value : null;
  // No recorded position: assume the normal (flowing) one, and say so.
  const position = iso ? (recorded ?? node.attrs?.normalPosition?.value ?? iso.options.find((o) => o !== iso.blocks)) : null;
  const blocking = iso && position === iso.blocks;

  const set = (k, v) => onEdit([{ op: 'updateNode', id: node.id, set: { [k]: v } }], `Set ${attrLabel(k)} on ${node.name}`);
  const unset = (k) => onEdit([{ op: 'updateNode', id: node.id, unset: [k] }], `Cleared ${attrLabel(k)} on ${node.name}`);

  return (
    <div className="sx-inspector">
      <div className="sx-insp-head">
        <svg width="40" height="40" viewBox="-20 -20 40 40" className="sx-insp-glyph"><Glyph shape={t?.shape ?? 'circle'} colour={sys ? systemColour(sys) : '#E9F2FF'} size={13} blocked={blocking} /></svg>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            className="sx-title-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== node.name && onEdit([{ op: 'updateNode', id: node.id, name }], `Renamed ${node.name} to ${name}`)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="sx-insp-sub">
            <span>{t?.label ?? node.type}</span>
            <span className="sx-sep">·</span>
            <select
              className="sx-chip-select"
              value={node.system ?? ''}
              onChange={(e) => onEdit([{ op: 'updateNode', id: node.id, system: e.target.value || null }], `Set system of ${node.name}`)}
            >
              <option value="">{sys && !node.system ? `${SYSTEMS[sys]?.label} (from type)` : 'No system'}</option>
              {Object.entries(SYSTEMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {node.pos ? <span className="sx-pill">Placed</span> : node.type === 'Equipment' && modelTags?.has(node.name) ? <span className="sx-pill">On the model</span> : <span className="sx-pill sx-pill-dim">Not placed</span>}
          </div>
        </div>
      </div>

      {iso && (
        <div className={`sx-toggle-row ${blocking ? 'sx-toggle-blocking' : ''}`}>
          <span>{node.type === 'Valve' || node.type === 'Damper' ? 'Valve is' : 'Switch is'}{!recorded && <span className="sx-muted" style={{ fontWeight: 400 }}> (assumed)</span>}</span>
          <div className="sx-seg">
            {iso.options.map((o) => (
              <button key={o} type="button" className={position === o ? 'sx-seg-on' : ''} onClick={() => set(iso.attr, o)}>
                {o === 'open' && iso.blocks === 'open' ? 'open (off)' : o === 'closed' && iso.blocks === 'open' ? 'closed (on)' : o}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sx-actions">{actions}</div>

      <div className="sx-section-title">Values</div>
      <div className="sx-values">
        {shownNames.map((k) => <ValueRow key={k} name={k} type={node.type} fact={node.attrs?.[k]} onSave={set} onRemove={unset} />)}
        {hiddenEmpty > 0 && <button type="button" className="sx-more" onClick={() => setShowAll(true)}>+ {hiddenEmpty} more fields</button>}
      </div>
      <AddValue existing={names} onAdd={set} />

      <div className="sx-section-title">Connections <span className="sx-muted">{ins.length + outs.length}</span></div>
      {ins.length + outs.length === 0 && <div className="sx-empty-note">Not connected yet. Use <strong>Connect</strong> and click another component.</div>}
      {ins.map((l) => <ConnectionRow key={`i${l.from}${l.type}`} link={l} other={nodes.get(l.from)} dir="in" nodes={nodes} onSelectLink={(x) => onSelect({ kind: 'link', key: `${x.from}|${x.type}|${x.to}` })} onSelectNode={(id) => onSelect({ kind: 'node', id }, true)} />)}
      {outs.map((l) => <ConnectionRow key={`o${l.to}${l.type}`} link={l} other={nodes.get(l.to)} dir="out" nodes={nodes} onSelectLink={(x) => onSelect({ kind: 'link', key: `${x.from}|${x.type}|${x.to}` })} onSelectNode={(id) => onSelect({ kind: 'node', id }, true)} />)}

      <div className="sx-insp-foot">
        <span className="sx-muted">{node.createdAt ? `Added ${new Date(node.createdAt).toLocaleDateString()}` : node.id}</span>
        <button type="button" className="sx-btn sx-btn-danger-ghost" onClick={() => onEdit([{ op: 'removeNode', id: node.id }], `Removed ${node.name}`) && onSelect(null)}>Delete</button>
      </div>
    </div>
  );
}

/** Inspector for a connection. */
export function LinkInspector({ graph, link, onEdit, onSelect }) {
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const a = nodes.get(link.from);
  const b = nodes.get(link.to);
  const key = { from: link.from, to: link.to, type: link.type };
  const sys = systemOfLink(link, nodes);
  const t = LINK_TYPES[link.type];
  const names = [...new Set([...(t?.attrs ?? (link.type === 'feeds' ? [] : ['sizeIn', 'material'])), ...Object.keys(link.attrs ?? {})])];
  const set = (k, v) => onEdit([{ op: 'updateLink', key, set: { [k]: v } }], `Set ${attrLabel(k)} on ${a.name} → ${b.name}`);
  const unset = (k) => onEdit([{ op: 'updateLink', key, unset: [k] }], `Cleared ${attrLabel(k)} on ${a.name} → ${b.name}`);
  const retype = (type) => onEdit([
    { op: 'removeLink', key },
    { op: 'addLink', link: { from: link.from, to: link.to, type, system: link.system, attrs: Object.fromEntries(Object.entries(link.attrs ?? {}).map(([k, f]) => [k, f.value])) } },
  ], `Changed ${a.name} → ${b.name} to ${LINK_TYPES[type]?.label ?? type}`);
  const reverse = () => onEdit([
    { op: 'removeLink', key },
    { op: 'addLink', link: { from: link.to, to: link.from, type: link.type, system: link.system, attrs: Object.fromEntries(Object.entries(link.attrs ?? {}).map(([k, f]) => [k, f.value])) } },
  ], `Reversed ${a.name} → ${b.name}`);

  return (
    <div className="sx-inspector">
      <div className="sx-insp-head">
        <svg width="40" height="40" viewBox="-20 -20 40 40" className="sx-insp-glyph"><path d="M-14,0 L14,0" stroke={systemColour(sys)} strokeWidth={5} strokeLinecap="round" /><path d="M6,-6 L14,0 L6,6" fill="none" stroke={systemColour(sys)} strokeWidth={3} /></svg>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sx-link-title">
            <a onClick={() => onSelect({ kind: 'node', id: a.id }, true)}>{a.name}</a>
            <span className="sx-muted"> {t?.verb ?? link.type} </span>
            <a onClick={() => onSelect({ kind: 'node', id: b.id }, true)}>{b.name}</a>
          </div>
          <div className="sx-insp-sub">
            <select className="sx-chip-select" value={link.type} onChange={(e) => retype(e.target.value)}>
              {Object.entries(LINK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <span className="sx-sep">·</span>
            <select className="sx-chip-select" value={link.system ?? ''} onChange={(e) => onEdit([{ op: 'updateLink', key, system: e.target.value || null }], `Set system of ${a.name} → ${b.name}`)}>
              <option value="">{`${SYSTEMS[sys]?.label ?? 'Other'} (inferred)`}</option>
              {Object.entries(SYSTEMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <ProvenanceChip fact={link} />
          </div>
        </div>
      </div>
      <div className="sx-actions">
        {t?.directed && <button type="button" className="sx-btn sx-btn-ghost" onClick={reverse}>⇄ Reverse direction</button>}
      </div>
      {names.length > 0 && <div className="sx-section-title">Values</div>}
      <div className="sx-values">
        {names.map((k) => <ValueRow key={k} name={k} type="" fact={link.attrs?.[k]} onSave={set} onRemove={unset} />)}
      </div>
      <AddValue existing={names} onAdd={set} />
      <div className="sx-insp-foot">
        <span className="sx-muted">{link.source}</span>
        <button type="button" className="sx-btn sx-btn-danger-ghost" onClick={() => onEdit([{ op: 'removeLink', key }], `Disconnected ${a.name} → ${b.name}`) && onSelect(null)}>Delete</button>
      </div>
    </div>
  );
}

export { isIsolationDevice };
