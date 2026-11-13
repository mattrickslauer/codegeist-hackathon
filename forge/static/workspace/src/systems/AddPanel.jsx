import { useEffect, useMemo, useState } from 'react';
import { ATTRS, NODE_TYPES, SYSTEMS, attrLabel } from '../../../../src/graphSchema.js';
import { Glyph } from './Schematic.jsx';
import { systemColour } from '../../../../src/graphSchema.js';
import { PALETTE, defaultLinkType, nextTag } from './addHelpers.js';

export { PALETTE, nextTag, defaultLinkType };

/**
 * Add a component. With `from` set (the selected component), the new one is connected after it: walking a pipe
 * run is "Add next" → Enter → "Add next" → Enter.
 */
export default function AddPanel({ graph, initialType, from, drawingSystem, inheritAttrs, canPlace, onCreate, onClose }) {
  const [type, setType] = useState(initialType ?? null);
  const [name, setName] = useState('');
  const [system, setSystem] = useState(drawingSystem ?? '');
  const [values, setValues] = useState({});
  const [connect, setConnect] = useState(Boolean(from));
  const [place, setPlace] = useState(false);
  const fromNode = useMemo(() => graph.nodes.find((n) => n.id === from), [graph, from]);

  useEffect(() => {
    if (!type) return;
    setName(nextTag(graph, type, fromNode?.type === type ? fromNode.name : null));
    const typeSystem = NODE_TYPES[type]?.system;
    setSystem(typeSystem ?? drawingSystem ?? fromNode?.system ?? '');
    const template = NODE_TYPES[type]?.attrs ?? [];
    const seeded = {};
    if (inheritAttrs?.sizeIn && template.includes('sizeIn')) seeded.sizeIn = inheritAttrs.sizeIn;
    if (NODE_TYPES[type]?.isolation) seeded.position = NODE_TYPES[type].isolation.blocks === 'closed' ? 'open' : 'closed';
    setValues(seeded);
  }, [type]);

  const template = (type && NODE_TYPES[type]?.attrs) || [];
  const quick = template.filter((k) => ATTRS[k] && k !== 'position' && k !== 'normalPosition').slice(0, 3);

  const submit = (e) => {
    e?.preventDefault();
    if (!type || !name.trim()) return;
    onCreate({ type, name: name.trim(), system: system || null, values, connectFrom: connect ? from : null, place });
  };

  if (!type) {
    return (
      <div className="sx-pop sx-palette" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="sx-pop-head"><strong>Add a component</strong><button type="button" className="sx-x" onClick={onClose}>×</button></div>
        {PALETTE.map(([group, types]) => (
          <div key={group}>
            <div className="sx-palette-group">{group}</div>
            <div className="sx-palette-grid">
              {types.map((t) => {
                const sys = NODE_TYPES[t].system ?? drawingSystem;
                return (
                  <button key={t} type="button" className="sx-palette-item" onClick={() => setType(t)}>
                    <svg width="34" height="30" viewBox="-17 -15 34 30"><Glyph shape={NODE_TYPES[t].shape} colour={sys ? systemColour(sys) : '#E9F2FF'} size={10} /></svg>
                    <span>{NODE_TYPES[t].label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <form className="sx-pop sx-addform" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sx-pop-head">
        <span className="row" style={{ gap: 8 }}>
          <svg width="28" height="26" viewBox="-14 -13 28 26"><Glyph shape={NODE_TYPES[type].shape} colour={system ? systemColour(system) : '#E9F2FF'} size={9} /></svg>
          <strong>New {NODE_TYPES[type].label.toLowerCase()}</strong>
        </span>
        <button type="button" className="sx-x" onClick={onClose}>×</button>
      </div>
      <label className="sx-field"><span>Tag or name</span><input autoFocus className="sx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'ServedArea' ? 'Level 3 east offices' : ''} /></label>
      <label className="sx-field"><span>System</span>
        <select className="sx-input" value={system} onChange={(e) => setSystem(e.target.value)}>
          <option value="">None</option>
          {Object.entries(SYSTEMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </label>
      {quick.length > 0 && (
        <div className="sx-field-row">
          {quick.map((k) => (
            <label key={k} className="sx-field">
              <span>{attrLabel(k)}{ATTRS[k].unit ? ` (${ATTRS[k].unit})` : ''}</span>
              {ATTRS[k].options
                ? <select className="sx-input" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })}><option value="">—</option>{ATTRS[k].options.map((o) => <option key={o}>{o}</option>)}</select>
                : <input className="sx-input" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />}
            </label>
          ))}
        </div>
      )}
      {NODE_TYPES[type].isolation && (
        <label className="sx-field"><span>Position now</span>
          <select className="sx-input" value={values.position ?? ''} onChange={(e) => setValues({ ...values, position: e.target.value })}>
            {NODE_TYPES[type].isolation.options.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      )}
      {fromNode && <label className="sx-check"><input type="checkbox" checked={connect} onChange={(e) => setConnect(e.target.checked)} /> Connect after <strong>{fromNode.name}</strong></label>}
      {canPlace && <label className="sx-check"><input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} /> Then click the model to place it</label>}
      <div className="sx-pop-foot">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setType(null)}>← Types</button>
        <button type="submit" className="sx-btn sx-btn-primary" disabled={!name.trim()}>Add {name.trim() || ''} <kbd>↵</kbd></button>
      </div>
    </form>
  );
}
