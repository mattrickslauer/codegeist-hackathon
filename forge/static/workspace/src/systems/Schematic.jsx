import { useEffect, useMemo, useRef, useState } from 'react';
import { NODE_TYPES, blocksFlow, systemColour, systemOfLink, systemOfNode } from '../../../../src/graphSchema.js';
import { schematicLayout } from './layout.js';

const WAVE_MS = 320;
const linkKey = (l) => `${l.from}|${l.type}|${l.to}`;

/** Small glyph per component shape, centred on 0,0. */
export function Glyph({ shape, colour, size = 14, blocked }) {
  const s = size;
  const common = { fill: colour, stroke: blocked ? '#FBC828' : 'rgba(0,0,0,.35)', strokeWidth: blocked ? 2.5 : 1 };
  switch (shape) {
    case 'box': return <rect x={-s} y={-s * 0.8} width={s * 2} height={s * 1.6} rx={3} {...common} />;
    case 'panel': return <rect x={-s * 0.7} y={-s} width={s * 1.4} height={s * 2} rx={2} {...common} />;
    case 'valve': return <path d={`M${-s},${-s * 0.75} L${s},${s * 0.75} L${s},${-s * 0.75} L${-s},${s * 0.75} Z`} {...common} strokeLinejoin="round" />;
    case 'switch': return <g><circle r={s * 0.85} {...common} /><path d={`M${-s * 0.5},${s * 0.3} L${s * 0.5},${-s * 0.4}`} stroke="rgba(0,0,0,.6)" strokeWidth={2} strokeLinecap="round" /></g>;
    case 'source': return <path d={`M0,${-s * 1.1} L${s},${-s * 0.55} L${s},${s * 0.55} L0,${s * 1.1} L${-s},${s * 0.55} L${-s},${-s * 0.55} Z`} {...common} />;
    case 'area': return <rect x={-s * 1.1} y={-s * 0.6} width={s * 2.2} height={s * 1.2} rx={s * 0.6} {...common} fillOpacity={0.55} strokeDasharray="3 2" />;
    case 'loop': return <circle r={s * 0.85} fill="none" stroke={colour} strokeWidth={s * 0.45} />;
    case 'line': return <rect x={-s} y={-s * 0.35} width={s * 2} height={s * 0.7} rx={s * 0.35} {...common} />;
    case 'dot': return <circle r={s * 0.5} {...common} />;
    default: return <circle r={s * 0.8} {...common} />;
  }
}

/**
 * The schematic: a generated one-line diagram of the visible systems. Same selection model as the 3D scene.
 * Pan by dragging, zoom with the wheel; `focusId` scrolls a component into view.
 */
export default function Schematic({ graph, selected, trace, impact, isolation, mode, connectFrom, onSelect, focusId, focusNonce }) {
  const svgRef = useRef(null);
  const [view, setView] = useState(null); // { x, y, k }
  const [hover, setHover] = useState(null);
  const [now, setNow] = useState(0);
  const layout = useMemo(() => schematicLayout(graph.nodes, graph.links), [graph]);
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // Fit on first layout.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || view) return;
    const w = el.clientWidth || 900;
    const h = el.clientHeight || 600;
    const k = Math.min(1.2, Math.max(0.25, Math.min(w / layout.width, h / layout.height)));
    setView({ k, x: (w - layout.width * k) / 2, y: Math.max(20, (h - layout.height * k) / 2) });
  }, [layout, view]);

  // Scroll a focused component into the middle.
  useEffect(() => {
    const el = svgRef.current;
    const p = focusId && layout.pos.get(focusId);
    if (!el || !p || !view) return;
    // Centre in the space left of the inspector panel when it is open.
    const free = el.clientWidth > 900 ? el.clientWidth - 360 : el.clientWidth;
    setView((v) => {
      const k = Math.max(v.k, 0.8);
      return { k, x: free / 2 - p.x * k, y: el.clientHeight / 2 - p.y * k };
    });
  }, [focusId, focusNonce]);

  // Drive the failure wave.
  useEffect(() => {
    if (!impact) return undefined;
    let raf = 0;
    const maxDepth = Math.max(0, ...impact.lost.values());
    const loop = () => {
      const t = performance.now() - impact.startedAt;
      setNow(t);
      if (t < (maxDepth + 3) * WAVE_MS) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [impact]);

  const drag = useRef(null);
  const onWheel = (e) => {
    e.preventDefault();
    const r = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const k = Math.min(3, Math.max(0.15, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
    });
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const lostAt = (id) => (impact?.lost.has(id) ? impact.lost.get(id) * WAVE_MS : Infinity);
  const isLost = (id) => now >= lostAt(id);
  const dim = Boolean(trace || impact || isolation);
  const selectedId = selected?.kind === 'node' ? selected.id : null;
  const selectedLink = selected?.kind === 'link' ? selected.key : null;

  if (!view) return <svg ref={svgRef} className="sx-schematic" />;

  return (
    <svg
      ref={svgRef}
      className={`sx-schematic ${mode === 'connect' ? 'sx-connecting' : ''}`}
      onPointerDown={(e) => { if (e.target === svgRef.current || e.target.dataset.bg) drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
        setView({ ...d.v, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y });
      }}
      onPointerUp={() => { if (drag.current && !drag.current.moved) onSelect?.(null); drag.current = null; }}
      onPointerLeave={() => { drag.current = null; }}
    >
      <defs>
        <pattern id="sx-dots" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x % 24} ${view.y % 24}) scale(${view.k})`}>
          <circle cx="1.5" cy="1.5" r="1.1" className="sx-dot" />
        </pattern>
        <marker id="sx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>
      <rect data-bg="1" width="100%" height="100%" fill="url(#sx-dots)" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {graph.links.map((l) => {
          const a = layout.pos.get(l.from);
          const b = layout.pos.get(l.to);
          if (!a || !b) return null;
          const key = linkKey(l);
          const sys = systemOfLink(l, nodesById);
          const lostLink = impact && isLost(l.to) && (impact.lost.has(l.from) || impact.failed.has(l.from));
          const traced = trace?.links.has(key);
          const colour = lostLink ? '#F15B50' : systemColour(sys);
          const dashedType = l.type === 'serves' || l.type === 'connects' || l.type === 'controls' || l.type === 'supportedBy';
          const midX = (a.x + b.x) / 2;
          const d = `M${a.x + 16},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x - 18},${b.y}`;
          const width = l.attrs?.sizeIn?.value ? Math.min(7, 1.5 + l.attrs.sizeIn.value / 2) : 2.5;
          const sel = key === selectedLink;
          return (
            <g key={key} className="sx-link" onPointerUp={(e) => { e.stopPropagation(); onSelect?.({ kind: 'link', key }); }}>
              <path d={d} className="sx-link-hit" />
              <path
                d={d}
                fill="none"
                stroke={colour}
                strokeWidth={sel ? width + 2.5 : width}
                strokeOpacity={dim && !traced && !lostLink ? 0.12 : dashedType ? 0.55 : 0.9}
                strokeDasharray={dashedType ? '5 5' : undefined}
                markerEnd={!dashedType ? 'url(#sx-arrow)' : undefined}
              />
              {!dashedType && !lostLink && !(dim && !traced) && <path d={d} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={Math.max(1.2, width / 2.2)} className="sx-flow" />}
              {sel && <path d={d} fill="none" stroke={colour} strokeWidth={width + 9} strokeOpacity={0.25} />}
            </g>
          );
        })}
        {graph.nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const shape = NODE_TYPES[n.type]?.shape ?? 'circle';
          const sys = systemOfNode(n);
          const lost = impact && isLost(n.id);
          const failed = impact?.failed.has(n.id);
          const iso = isolation?.has(n.id);
          const traced = trace?.ids.has(n.id);
          const faded = dim && !traced && !iso && !(impact?.lost.has(n.id));
          const colour = lost ? '#F15B50' : iso ? '#FBC828' : sys ? systemColour(sys) : n.type === 'Equipment' ? '#E9F2FF' : '#B3B9C4';
          const sel = n.id === selectedId;
          const value = keyValue(n);
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              className={`sx-node ${faded ? 'sx-faded' : ''} ${lost ? 'sx-lost' : ''}`}
              onPointerUp={(e) => { e.stopPropagation(); onSelect?.({ kind: 'node', id: n.id }); }}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
            >
              {(sel || n.id === connectFrom || hover === n.id) && <circle r={24} className={n.id === connectFrom ? 'sx-halo sx-halo-green' : 'sx-halo'} />}
              {(failed || iso) && <circle r={20} className={failed ? 'sx-pulse sx-pulse-red' : 'sx-pulse sx-pulse-amber'} />}
              {lost && !failed && now - lostAt(n.id) < 900 && <circle r={14 + (now - lostAt(n.id)) / 30} className="sx-shock" style={{ opacity: Math.max(0, 1 - (now - lostAt(n.id)) / 900) }} />}
              <Glyph shape={shape} colour={colour} blocked={blocksFlow(n)} />
              <text y={30} textAnchor="middle" className="sx-node-label">{n.name.length > 26 ? `${n.name.slice(0, 25)}…` : n.name}</text>
              {value && <text y={44} textAnchor="middle" className="sx-node-value">{value}</text>}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** The one value worth showing under a component in the schematic. */
function keyValue(n) {
  const a = n.attrs ?? {};
  const v = (k) => a[k]?.value;
  if (NODE_TYPES[n.type]?.isolation && v('position')) return `${v('position')}${v('sizeIn') ? ` · ${v('sizeIn')} in` : ''}${v('ratingA') ? ` · ${v('ratingA')} A` : ''}`;
  if (v('ratingA')) return `${v('ratingA')} A`;
  if (v('busA')) return `${v('busA')} A bus`;
  if (v('flowGpm')) return `${v('flowGpm')} gpm`;
  if (v('sizeIn')) return `${v('sizeIn')} in`;
  if (v('size')) return `${v('sets') > 1 ? `${v('sets')} × ` : ''}${v('size')}`;
  if (n.type === 'Equipment' && v('category')) return String(v('category')).slice(0, 28);
  return '';
}
