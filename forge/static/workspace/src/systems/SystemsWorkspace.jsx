import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_TYPES, SYSTEMS, systemOfLink, systemOfNode } from '../../../../src/graphSchema.js';
import { impact as computeImpact, isolationPlan, trace as computeTrace } from '../../../../src/graphImpact.js';
import { api } from '../api.js';
import { visibleSubgraph } from './layout.js';
import { useSiteGraph } from './useSiteGraph.js';
import Schematic from './Schematic.jsx';
import { LinkInspector, NodeInspector, SystemDot } from './Inspector.jsx';
import AddPanel, { defaultLinkType } from './AddPanel.jsx';
import ImportDialog from './ImportDialog.jsx';
import TableView from './TableView.jsx';
import './systems.css';

// three.js + bloom is large: load the 3D scene only when shown.
const SystemsScene = lazy(() => import('./SystemsScene.jsx'));

const linkKey = (l) => `${l.from}|${l.type}|${l.to}`;
const VIEWS = [['3d', '3D'], ['split', 'Split'], ['schematic', 'Schematic'], ['table', 'Table']];
const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);

function Icon({ name }) {
  const d = {
    select: 'M5 3l12 7-5 1.5L9.5 17z',
    connect: 'M6 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm8-4a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM8.5 9.5l3-2.5',
    add: 'M10 4v12M4 10h12',
    place: 'M10 2a5 5 0 0 1 5 5c0 4-5 10-5 10S5 11 5 7a5 5 0 0 1 5-5zm0 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
    undo: 'M7 5L3 9l4 4M3 9h9a5 5 0 0 1 0 10h-2',
    paste: 'M7 3h6v3H7zM5 5h-1v13h12V5h-1',
    history: 'M10 4a6 6 0 1 1-6 6M4 4v4h4M10 7v3l2 2',
    search: 'M9 3a6 6 0 1 1 0 12A6 6 0 0 1 9 3zm4.5 10.5L18 18',
  }[name];
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

/** Onboarding progress: how much of the building is mapped. */
function progressOf(graph) {
  const linked = new Set();
  for (const l of graph.links) { linked.add(l.from); linked.add(l.to); }
  const equipment = graph.nodes.filter((n) => n.type === 'Equipment');
  const connectedEq = equipment.filter((n) => linked.has(n.id)).length;
  const valued = graph.nodes.filter((n) => Object.keys(n.attrs ?? {}).length > 0).length;
  const devices = graph.nodes.filter((n) => NODE_TYPES[n.type]?.isolation).length;
  return {
    components: graph.nodes.length,
    connections: graph.links.filter((l) => l.type !== 'locatedOn').length,
    equipment: equipment.length,
    connectedEq,
    pctConnected: equipment.length ? Math.round((100 * connectedEq) / equipment.length) : 0,
    pctValued: graph.nodes.length ? Math.round((100 * valued) / graph.nodes.length) : 0,
    devices,
    unconnected: graph.nodes.filter((n) => !linked.has(n.id) && n.type !== 'Level').length,
  };
}

function Ring({ pct, colour = 'var(--sx-accent)' }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="sx-ring">
      <circle cx="20" cy="20" r={r} className="sx-ring-bg" />
      <circle cx="20" cy="20" r={r} stroke={colour} strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 20 20)" className="sx-ring-fg" />
      <text x="20" y="23.5" textAnchor="middle" style={{ fontSize: pct === 100 ? 9 : 10 }}>{pct}%</text>
    </svg>
  );
}

/** Start screen for a site with no connections yet. */
function StartPanel({ site, sg }) {
  return (
    <div className="sx-start">
      <div className="sx-start-card">
        <div className="sx-start-art" aria-hidden="true">
          <svg viewBox="0 0 220 90" width="220" height="90">
            <path d="M20 60 C70 60 60 25 110 25 S160 60 200 60" fill="none" stroke="#2898BD" strokeWidth="4" className="sx-flow-demo" />
            <path d="M20 70 C80 70 90 45 140 45 S180 70 200 70" fill="none" stroke="#F5CD47" strokeWidth="3" className="sx-flow-demo" />
            <circle cx="20" cy="60" r="7" fill="#2898BD" /><circle cx="110" cy="25" r="6" fill="#2898BD" /><circle cx="200" cy="60" r="8" fill="#E9F2FF" />
            <path d="M134 39 L146 51 L146 39 L134 51 Z" fill="#F5CD47" />
          </svg>
        </div>
        <h2>Map {site.name}’s systems</h2>
        <p>Add the pipes, valves, pumps, panels and breakers that connect this building’s equipment, so anyone can see what feeds what, what a shutdown takes out, and what to close before work starts.</p>
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          {sg.canStartFromRegister && <button type="button" className="sx-btn sx-btn-primary" disabled={sg.saving} onClick={sg.start}>Start from the equipment register</button>}
          <button type="button" className={`sx-btn ${sg.canStartFromRegister ? 'sx-btn-ghost' : 'sx-btn-primary'}`} disabled={sg.saving} onClick={sg.start}>{sg.canStartFromRegister ? 'Start empty' : 'Start mapping'}</button>
        </div>
        <ol className="sx-start-steps">
          <li><strong>Paste</strong> a valve or panel schedule from a spreadsheet</li>
          <li><strong>Connect</strong> components by clicking one, then the next</li>
          <li><strong>Place</strong> them on the 3D model or scan</li>
          <li>Ask <strong>what if</strong> something fails, or how to isolate a unit</li>
        </ol>
      </div>
    </div>
  );
}

/** The systems workspace: 3D + schematic + table over one graph, with the editor overlaid. */
export default function SystemsWorkspace({ site, source, decisions = [], initialTag }) {
  const sg = useSiteGraph(site.id);
  const graph = sg.graph;
  const [view, setView] = useState('3d');
  const [mode, setMode] = useState('select');
  const [selected, setSelected] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [placing, setPlacing] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [xray, setXray] = useState(true);
  const [labels, setLabels] = useState('smart');
  const [drawingSystem, setDrawingSystem] = useState('chw');
  const [add, setAdd] = useState(null);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState(null);
  const [whatif, setWhatif] = useState(null);
  const [traceOn, setTraceOn] = useState(false);
  const [focus, setFocus] = useState({ id: null, nonce: 0 });
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sceneError, setSceneError] = useState(null);
  const [toast, setToast] = useState(null);
  const [modelTags, setModelTags] = useState(() => new Set());
  const searchRef = useRef(null);

  const nodes = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const links = useMemo(() => new Map((graph?.links ?? []).map((l) => [linkKey(l), l])), [graph]);
  const presentSystems = useMemo(() => {
    const count = new Map();
    for (const l of graph?.links ?? []) { if (l.type === 'locatedOn') continue; const s = systemOfLink(l, nodes); count.set(s, (count.get(s) ?? 0) + 1); }
    for (const n of graph?.nodes ?? []) { const s = systemOfNode(n); if (s && !count.has(s)) count.set(s, 0); }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph, nodes]);
  const visibleSystems = useMemo(() => (hidden.size ? new Set(Object.keys(SYSTEMS).filter((k) => !hidden.has(k))) : null), [hidden]);
  const visible = useMemo(() => (graph ? visibleSubgraph(graph, visibleSystems) : { nodes: [], links: [] }), [graph, visibleSystems]);
  const progress = useMemo(() => (graph ? progressOf(graph) : null), [graph]);

  const selectedNode = selected?.kind === 'node' ? nodes.get(selected.id) : null;
  const selectedLink = selected?.kind === 'link' ? links.get(selected.key) : null;

  // Initial selection from the URL (?equipment=RTU-1).
  useEffect(() => {
    if (!graph || !initialTag) return;
    const n = graph.nodes.find((x) => x.type === 'Equipment' && x.name === initialTag);
    if (n) { setSelected({ kind: 'node', id: n.id }); setFocus({ id: n.id, nonce: Date.now() }); }
  }, [Boolean(graph)]);

  // Deselect things that were deleted.
  useEffect(() => {
    if (selected?.kind === 'node' && !nodes.has(selected.id)) setSelected(null);
    if (selected?.kind === 'link' && !links.has(selected.key)) setSelected(null);
  }, [nodes, links]);

  const flash = (text) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? null : t)), 2600); };

  const edit = useCallback((ops, label) => sg.edit(ops, label), [sg.edit]);

  const traceData = useMemo(() => {
    if (!traceOn || !selectedNode || !graph) return null;
    const t = computeTrace(graph, selectedNode.id);
    const ids = new Set([selectedNode.id, ...t.upstream, ...t.downstream]);
    return { ids, links: new Set(t.links.map(linkKey)) };
  }, [traceOn, selectedNode, graph]);

  // What-if results stay live as the graph changes (e.g. toggling a valve while the panel is open).
  const impactData = useMemo(() => {
    if (whatif?.kind !== 'impact' || !graph) return null;
    const r = computeImpact(graph, whatif.failed);
    return { ...r, lostMap: new Map(r.lost.map((l) => [l.id, l.depth])) };
  }, [whatif, graph]);
  const isoData = useMemo(() => {
    if (whatif?.kind !== 'isolation' || !graph || !nodes.has(whatif.target)) return null;
    return isolationPlan(graph, whatif.target);
  }, [whatif, graph, nodes]);
  const sceneImpact = impactData ? { lost: impactData.lostMap, failed: new Set(impactData.failed), startedAt: whatif.startedAt } : null;
  const sceneIso = isoData ? new Set([isoData.target, ...isoData.operate.map((o) => o.id)]) : null;

  const select = useCallback((sel, fly) => {
    if (mode === 'connect' && sel?.kind === 'node') {
      if (!connectFrom) { setConnectFrom(sel.id); return; }
      if (sel.id === connectFrom) return;
      const a = nodes.get(connectFrom);
      const b = nodes.get(sel.id);
      const type = defaultLinkType(a, b, drawingSystem);
      const system = type === 'feeds' ? 'electrical' : type === 'serves' || type === 'supportedBy' ? undefined : (a.system ?? b.system ?? drawingSystem);
      const r = edit([{ op: 'addLink', link: { from: a.id, to: b.id, type, ...(system ? { system } : {}) } }], `Connected ${a.name} → ${b.name}`);
      if (r) {
        flash(`${a.name} → ${b.name}`);
        setSelected({ kind: 'link', key: `${a.id}|${type}|${b.id}` });
        setConnectFrom(b.id); // keep drawing the run from here
      }
      return;
    }
    if (mode === 'place') return;
    setSelected(sel?.kind === 'tag' ? sel : sel);
    if (sel?.kind === 'node' && fly) setFocus({ id: sel.id, nonce: Date.now() });
  }, [mode, connectFrom, nodes, drawingSystem, edit]);

  const startConnect = (fromId) => { setMode('connect'); setConnectFrom(fromId ?? null); setAdd(null); };
  const stopModes = () => { setMode('select'); setConnectFrom(null); setPlacing(null); setAdd(null); };

  const onPlace = (point) => {
    if (!placing) return;
    const n = nodes.get(placing);
    edit([{ op: 'updateNode', id: placing, pos: point }], `Placed ${n?.name ?? ''}`);
    flash(`Placed ${n?.name ?? ''}`);
    setSelected({ kind: 'node', id: placing });
    setPlacing(null);
    setMode('select');
  };

  const createComponent = ({ type, name, system, values, connectFrom: from, place }) => {
    const ops = [{ op: 'addNode', node: { type, name, ...(system ? { system } : {}), attrs: values } }];
    const r = edit(ops, `Added ${name}`);
    if (!r) return;
    const id = r.touched[0];
    if (from) {
      const a = nodes.get(from);
      const b = r.graph.nodes.find((n) => n.id === id);
      const linkType = defaultLinkType(a, b, system);
      const inherit = add?.inherit;
      edit([{ op: 'addLink', link: { from, to: id, type: linkType, ...(system && linkType !== 'serves' ? { system } : {}), ...(inherit?.sizeIn && linkType === 'flowsTo' ? { attrs: { sizeIn: inherit.sizeIn } } : {}) } }], `Connected ${a.name} → ${name}`);
    }
    setSelected({ kind: 'node', id });
    setAdd(null);
    flash(`Added ${name}`);
    if (place) { setPlacing(id); setMode('place'); if (view === 'schematic' || view === 'table') setView('3d'); }
  };

  const addNext = (node) => {
    const incoming = graph.links.find((l) => l.to === node.id && l.attrs?.sizeIn);
    setAdd({ type: node.type === 'Equipment' ? 'Valve' : node.type, from: node.id, inherit: { sizeIn: incoming?.attrs?.sizeIn?.value ?? node.attrs?.sizeIn?.value } });
  };

  const runImpact = (failed) => { setWhatif({ kind: 'impact', failed, startedAt: performance.now() }); setTraceOn(false); };
  const runIsolation = (id) => { setWhatif({ kind: 'isolation', target: id, startedAt: performance.now() }); setTraceOn(false); };

  const openHistory = async () => {
    setHistory({ loading: true, entries: [] });
    try { setHistory({ loading: false, entries: await api.graphHistory(site.id) }); } catch (e) { setHistory({ loading: false, entries: [], error: String(e?.message ?? e) }); }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); sg.undo(); return; }
      if (e.key === 'Escape') { stopModes(); setWhatif(null); setTraceOn(false); setSearchOpen(false); setImporting(false); return; }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); setSearchOpen(true); }
      else if (e.key === 'c') startConnect(selected?.kind === 'node' ? selected.id : null);
      else if (e.key === 'a') setAdd({ from: selected?.kind === 'node' ? selected.id : null });
      else if (e.key === 'v') stopModes();
      else if (e.key === 'x') setXray((x) => !x);
      else if (e.key === 't' && selectedNode) setTraceOn((t) => !t);
      else if (e.key === 'f' && selectedNode) setFocus({ id: selectedNode.id, nonce: Date.now() });
      else if (['1', '2', '3', '4'].includes(e.key)) setView(VIEWS[Number(e.key) - 1][0]);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        if (selectedNode) edit([{ op: 'removeNode', id: selectedNode.id }], `Removed ${selectedNode.name}`);
        if (selectedLink) edit([{ op: 'removeLink', key: { from: selectedLink.from, to: selectedLink.to, type: selectedLink.type } }], 'Removed a connection');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (sg.loading) return <div className="sx-root sx-center"><span className="sx-spinner" /> Loading systems…</div>;
  if (!graph) return <div className="sx-root">{sg.error && <div className="sx-error">{sg.error}</div>}<StartPanel site={site} sg={sg} /></div>;

  const q = query.trim().toLowerCase();
  const rank = (n) => { const name = n.name.toLowerCase(); const tag = n.id.split(':')[1]?.toLowerCase(); return name === q || tag === q ? 0 : name.startsWith(q) ? 1 : n.type === 'Equipment' ? 2 : 3; };
  const matches = q ? graph.nodes.filter((n) => n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 8) : [];
  const affectedDecisions = (() => {
    const ids = impactData ? impactData.lost.map((l) => l.id) : isoData ? [isoData.target, ...isoData.sideEffects.map((s) => s.id)] : [];
    const tags = new Set(ids.map((id) => nodes.get(id)).filter((n) => n?.type === 'Equipment').map((n) => n.name));
    return decisions.filter((d) => d.status === 'standing' && d.equipment.some((t) => tags.has(t)));
  })();

  const hint = mode === 'connect'
    ? (connectFrom ? <>Connecting from <strong>{nodes.get(connectFrom)?.name}</strong>: click where it goes next. Each click continues the run. <kbd>Esc</kbd> to stop.</> : <>Click the component the flow <strong>comes from</strong>.</>)
    : mode === 'place' ? <>Click the model (or the ground) to place <strong>{nodes.get(placing)?.name}</strong>. <kbd>Esc</kbd> to cancel.</> : null;

  const showScene = view === '3d' || view === 'split';
  const showSchematic = view === 'schematic' || view === 'split';

  const nodeActions = selectedNode && (
    <>
      <button type="button" className="sx-btn sx-btn-ghost" onClick={() => startConnect(selectedNode.id)} title="Connect from here (C)">Connect from here</button>
      <button type="button" className="sx-btn sx-btn-ghost" onClick={() => addNext(selectedNode)} title="Add the next component after this one">+ Add next in line</button>
      <button type="button" className="sx-btn sx-btn-ghost" onClick={() => { setPlacing(selectedNode.id); setMode('place'); if (!showScene) setView('3d'); }}>{selectedNode.pos ? 'Move on model' : 'Place on model'}</button>
      {selectedNode.pos && <button type="button" className="sx-btn sx-btn-ghost" onClick={() => edit([{ op: 'updateNode', id: selectedNode.id, pos: null }], `Unplaced ${selectedNode.name}`)}>Unplace</button>}
      <button type="button" className={`sx-btn ${traceOn ? 'sx-btn-on' : 'sx-btn-ghost'}`} onClick={() => setTraceOn((t) => !t)} title="Highlight everything upstream and downstream (T)">Trace</button>
      <button type="button" className="sx-btn sx-btn-warn" onClick={() => runImpact([selectedNode.id])}>What if it fails?</button>
      <button type="button" className="sx-btn sx-btn-ghost" onClick={() => runIsolation(selectedNode.id)}>How to isolate</button>
    </>
  );

  return (
    <div className={`sx-root sx-view-${view}`}>
      <div className="sx-stage">
        {showScene && (
          <div className="sx-pane sx-pane-3d">
            {sceneError && <div className="sx-error">{sceneError}</div>}
            <Suspense fallback={<div className="sx-center"><span className="sx-spinner" /> Loading 3D…</div>}>
              <SystemsScene
                source={source}
                graph={visible}
                selected={selected}
                trace={traceData}
                impact={sceneImpact}
                isolation={sceneIso}
                mode={mode}
                connectFrom={connectFrom}
                xray={xray}
                labels={labels}
                focusId={focus.id}
                focusNonce={focus.nonce}
                onSelect={select}
                onPlace={onPlace}
                onReady={(r) => setModelTags(new Set(r.tags))}
                onError={(e) => setSceneError(`Couldn’t render the model: ${String(e?.message ?? e)}`)}
              />
            </Suspense>
          </div>
        )}
        {showSchematic && (
          <div className="sx-pane sx-pane-schematic">
            <Schematic graph={visible} selected={selected} trace={traceData} impact={sceneImpact} isolation={sceneIso} mode={mode} connectFrom={connectFrom} onSelect={select} focusId={focus.id} focusNonce={focus.nonce} />
          </div>
        )}
        {view === 'table' && <div className="sx-pane sx-pane-table"><TableView graph={graph} selected={selected} onSelect={(s) => setSelected(s)} /></div>}
      </div>

      {/* Top toolbar */}
      <div className="sx-toolbar">
        <div className="sx-tools">
          <button type="button" className={`sx-tool ${mode === 'select' ? 'sx-tool-on' : ''}`} onClick={stopModes} title="Select (V)"><Icon name="select" /><span>Select</span></button>
          <button type="button" className={`sx-tool ${mode === 'connect' ? 'sx-tool-on' : ''}`} onClick={() => (mode === 'connect' ? stopModes() : startConnect(selectedNode?.id))} title="Connect (C)"><Icon name="connect" /><span>Connect</span></button>
          <button type="button" className={`sx-tool ${add ? 'sx-tool-on' : ''}`} onClick={() => setAdd(add ? null : { from: selectedNode?.id ?? null })} title="Add a component (A)"><Icon name="add" /><span>Add</span></button>
          <span className="sx-tool-sep" />
          <label className="sx-drawing" title="System for new connections">
            <SystemDot system={drawingSystem} size={12} />
            <select value={drawingSystem} onChange={(e) => setDrawingSystem(e.target.value)}>
              {Object.entries(SYSTEMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <span className="sx-tool-sep" />
          <button type="button" className="sx-tool" onClick={sg.undo} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
          <button type="button" className="sx-tool" onClick={() => setImporting(true)} title="Paste from a spreadsheet"><Icon name="paste" /><span>Paste</span></button>
          <button type="button" className="sx-tool" onClick={openHistory} title="History"><Icon name="history" /></button>
        </div>
        <div className="sx-search">
          <Icon name="search" />
          <input
            ref={searchRef}
            placeholder="Find a tag…  /"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { select({ kind: 'node', id: matches[0].id }, true); setQuery(''); e.currentTarget.blur(); } }}
          />
          {searchOpen && matches.length > 0 && (
            <div className="sx-search-results">
              {matches.map((n) => (
                <button key={n.id} type="button" onMouseDown={() => { select({ kind: 'node', id: n.id }, true); setQuery(''); }}>
                  <SystemDot system={systemOfNode(n) ?? 'other'} /> <strong>{n.name}</strong> <span className="sx-muted">{NODE_TYPES[n.type]?.label ?? n.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sx-views">
          {VIEWS.map(([k, label], i) => <button key={k} type="button" className={view === k ? 'sx-view-on' : ''} onClick={() => setView(k)} title={`${label} (${i + 1})`}>{label}</button>)}
        </div>
      </div>

      {/* Left: progress + layers */}
      {view !== 'table' && (
        <div className="sx-panel sx-layers">
          <div className="sx-progress">
            <Ring pct={progress.pctConnected} />
            <div>
              <div className="sx-progress-title">{progress.connectedEq} of {progress.equipment} units connected</div>
              <div className="sx-muted">{progress.components} components · {progress.connections} connections · {progress.devices} valves &amp; switches</div>
            </div>
          </div>
          {progress.unconnected > 0 && <div className="sx-muted sx-small">{progress.unconnected} not connected yet</div>}
          <div className="sx-section-title">Systems</div>
          {presentSystems.length === 0 && <div className="sx-empty-note">Nothing drawn yet. Paste a schedule or press <kbd>A</kbd>.</div>}
          {presentSystems.map(([key, count]) => (
            <label key={key} className={`sx-layer ${hidden.has(key) ? 'sx-layer-off' : ''}`}>
              <input type="checkbox" checked={!hidden.has(key)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; })} />
              <SystemDot system={key} size={12} />
              <span className="sx-layer-name">{SYSTEMS[key]?.label ?? key}</span>
              <span className="sx-muted">{count}</span>
              <button type="button" className="sx-only" onClick={(e) => { e.preventDefault(); setHidden(new Set(Object.keys(SYSTEMS).filter((k) => k !== key))); }}>only</button>
            </label>
          ))}
          {hidden.size > 0 && <button type="button" className="sx-btn sx-btn-ghost sx-small" onClick={() => setHidden(new Set())}>Show all systems</button>}
          {showScene && (
            <>
              <div className="sx-section-title">View</div>
              <label className="sx-switch"><input type="checkbox" checked={xray} onChange={() => setXray((x) => !x)} /><span>X-ray building</span><kbd>X</kbd></label>
              <label className="sx-switch"><input type="checkbox" checked={labels === 'all'} onChange={() => setLabels((l) => (l === 'all' ? 'smart' : 'all'))} /><span>All labels</span></label>
            </>
          )}
          <div className="sx-legend">
            <span><i className="sx-lg-amber" /> closed valve / open breaker</span>
            <span><i className="sx-lg-float" /> floating = not placed on the model yet</span>
          </div>
        </div>
      )}

      {/* Right: inspector */}
      {(selectedNode || selectedLink || selected?.kind === 'tag') && (
        <div className="sx-panel sx-right">
          <button type="button" className="sx-x sx-close" onClick={() => setSelected(null)}>×</button>
          {selectedNode && <NodeInspector graph={graph} node={selectedNode} onEdit={edit} onSelect={select} actions={nodeActions} modelTags={modelTags} />}
          {selectedLink && <LinkInspector graph={graph} link={selectedLink} onEdit={edit} onSelect={select} />}
          {selected?.kind === 'tag' && (
            <div className="sx-inspector">
              <h3 className="sx-link-title">{selected.tag}</h3>
              <p className="sx-muted">This unit is in the model but not in the systems map yet.</p>
              <button type="button" className="sx-btn sx-btn-primary" onClick={() => { const r = edit([{ op: 'addNode', node: { type: 'Equipment', name: selected.tag } }], `Added ${selected.tag}`); if (r) setSelected({ kind: 'node', id: r.touched[0] }); }}>Add {selected.tag} to the map</button>
            </div>
          )}
        </div>
      )}

      {/* Add palette */}
      {add && (
        <div className="sx-add-anchor">
          <AddPanel graph={graph} initialType={add.type} from={add.from} inheritAttrs={add.inherit} drawingSystem={drawingSystem} canPlace={showScene || Boolean(source)} onCreate={createComponent} onClose={() => setAdd(null)} />
        </div>
      )}

      {/* What-if */}
      {(impactData || isoData) && (
        <div className="sx-panel sx-whatif">
          {impactData && (
            <>
              <div className="sx-whatif-head">
                <span className="sx-pulse-dot" />
                <div>
                  <div className="sx-whatif-title">If {impactData.failed.map((id) => nodes.get(id)?.name).join(' + ')} fails</div>
                  <div className="sx-muted">
                    {impactData.lost.length <= impactData.failed.length
                      ? 'Nothing else loses supply: something else still feeds everything downstream.'
                      : `${impactData.lost.length - impactData.failed.length} components lose supply`}
                  </div>
                </div>
              </div>
              <div className="sx-whatif-stats">
                {['Equipment', 'ServedArea'].map((t) => <div key={t}><strong>{impactData.lostByType[t] ?? 0}</strong><span>{t === 'Equipment' ? 'units' : 'areas'}</span></div>)}
                <div><strong>{impactData.lost.filter((l) => NODE_TYPES[nodes.get(l.id)?.type]?.isolation).length}</strong><span>valves &amp; switches</span></div>
              </div>
              <div className="sx-whatif-list">
                {impactData.lost.filter((l) => ['Equipment', 'ServedArea'].includes(nodes.get(l.id)?.type)).map((l) => (
                  <button key={l.id} type="button" onClick={() => select({ kind: 'node', id: l.id }, true)}><span className="sx-hop">{l.depth}</span>{nodes.get(l.id)?.name}</button>
                ))}
              </div>
            </>
          )}
          {isoData && (
            <>
              <div className="sx-whatif-head">
                <span className="sx-pulse-dot sx-pulse-dot-amber" />
                <div>
                  <div className="sx-whatif-title">Isolating {nodes.get(isoData.target)?.name}</div>
                  <div className="sx-muted">From the map: the first valve or switch on every path in.</div>
                </div>
              </div>
              {isoData.operate.length === 0 && <div className="sx-warn">No valve or switch on the map isolates it.</div>}
              <ol className="sx-steps">
                {isoData.operate.map((o) => (
                  <li key={o.id}><button type="button" onClick={() => select({ kind: 'node', id: o.id }, true)}><strong>{o.action === 'close' ? 'Close' : 'Open (off)'}</strong> {nodes.get(o.id)?.name}</button> <span className="sx-muted">{o.side}</span></li>
                ))}
              </ol>
              {isoData.unisolatedPaths.map((p) => <div key={p.join()} className="sx-warn">No isolation point upstream via {p.join(' → ')}</div>)}
              {isoData.unisolatedDownstream.map((p) => <div key={p.join()} className="sx-warn">Back-flow possible through {p.at(-1)} (fed from elsewhere, no valve before it)</div>)}
              {isoData.sideEffects.length > 0 && <div className="sx-muted sx-small">Also loses supply: {isoData.sideEffects.map((s) => nodes.get(s.id)?.name).join(', ')}</div>}
            </>
          )}
          {affectedDecisions.length > 0 && (
            <div className="sx-decisions">
              <div className="sx-section-title">Standing decisions affected</div>
              {affectedDecisions.map((d) => <div key={d.id} className="sx-decision"><strong>{d.equipment.join(', ')}</strong>: {d.statement}</div>)}
            </div>
          )}
          <div className="sx-pop-foot">
            <span className="sx-muted sx-small">From the systems map. A check for a licensed professional, not a lockout/tagout procedure.</span>
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setWhatif((w) => ({ ...w, startedAt: performance.now() }))}>↻ Replay</button>
              <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setWhatif(null)}>Clear</button>
            </span>
          </div>
        </div>
      )}

      {hint && <div className="sx-hint">{hint}</div>}
      {(toast || sg.saving || sg.error) && (
        <div className={`sx-status ${sg.error ? 'sx-status-error' : ''}`}>
          {sg.error ? <>{sg.error} <button type="button" className="sx-btn sx-btn-ghost" onClick={() => { sg.setError(null); sg.reload(); }}>Reload</button></> : sg.saving ? <><span className="sx-spinner" /> Saving…</> : toast}
        </div>
      )}

      {importing && <ImportDialog graph={graph} onClose={() => setImporting(false)} onImport={(ops, label) => { if (edit(ops, label)) { setImporting(false); flash(label); } }} />}

      {history && (
        <div className="sx-panel sx-history">
          <div className="sx-pop-head"><strong>History</strong><button type="button" className="sx-x" onClick={() => setHistory(null)}>×</button></div>
          {history.loading && <div className="sx-muted"><span className="sx-spinner" /> Loading…</div>}
          {history.error && <div className="sx-warn">{history.error}</div>}
          {!history.loading && history.entries.length === 0 && <div className="sx-muted">No edits yet.</div>}
          {history.entries.map((e) => (
            <div key={`${e.rev}-${e.at}`} className={`sx-hist ${e.undone ? 'sx-hist-undone' : ''}`}>
              <div>{e.label}</div>
              <div className="sx-muted sx-small">{new Date(e.at).toLocaleString()} · {e.count} change{e.count === 1 ? '' : 's'}{e.undone ? ' · undone' : ''}</div>
            </div>
          ))}
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => { sg.undo(); setTimeout(openHistory, 900); }}>Undo latest</button>
        </div>
      )}
    </div>
  );
}
