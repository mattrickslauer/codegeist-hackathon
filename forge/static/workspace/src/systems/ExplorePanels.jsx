import { useMemo, useState } from 'react';
import { NODE_TYPES, attrLabel, formatValue, systemOfNode } from '../../../../src/graphSchema.js';
import { context as equipmentContext, indexGraph } from '../../../../src/graphWalk.js';
import { keyFact } from '../EquipmentGraph.jsx';
import { openInJira } from '../api.js';
import { ProvenanceChip, SystemDot } from './Inspector.jsx';
import { STATUS_COLOURS } from './statusColours.js';
import './explore.css';

/**
 * Explore mode for the Building view (docs/ARCHITECTURE.md §5.2a): what a facilities manager or contractor sees
 * before they edit anything. Everything here reads the site graph, decisions and work orders; nothing writes.
 */

const STATUS_TEXT = {
  blocked: 'Blocked work order',
  approval: 'Awaiting approval',
  capacity: 'Near capacity',
  decision: 'Standing decision',
};

export function StatusPill({ status }) {
  if (!status) return null;
  return <span className={`sx-spill sx-spill-${status}`}><i style={{ background: STATUS_COLOURS[status] }} />{STATUS_TEXT[status]}</span>;
}

/** Colour key for the scene, bottom left. */
export function StatusLegend({ counts }) {
  return (
    <div className="sx-legend-bar">
      {Object.keys(STATUS_TEXT).map((k) => (
        <span key={k} className={counts?.[k] ? '' : 'sx-legend-off'}><i style={{ background: STATUS_COLOURS[k] }} />{STATUS_TEXT[k]}{counts?.[k] ? ` · ${counts[k]}` : ''}</span>
      ))}
    </div>
  );
}

const KIND = {
  blocked: { icon: '⛔', label: 'Blocked' },
  approval: { icon: '✋', label: 'Needs your approval' },
  capacity: { icon: '⚡', label: 'Near capacity' },
};

/** Left panel in explore mode: the few things that need someone, each one click from the equipment. */
export function AttentionPanel({ attention, standing, onFocusTag, onFocusNode, onOpenDecisions, onShowSystems, systemsOpen, children }) {
  const { items } = attention;
  return (
    <div className="sx-panel sx-layers sx-attention">
      <div className="sx-attn-head">
        <div className={`sx-attn-count ${items.length ? 'sx-attn-count-hot' : ''}`}>{items.length}</div>
        <div>
          <div className="sx-progress-title">{items.length ? 'Need attention' : 'All clear'}</div>
          <div className="sx-muted">{standing} standing decision{standing === 1 ? '' : 's'} guard this building</div>
        </div>
      </div>
      {items.length === 0 && <div className="sx-empty-note">No blocked work orders, approvals or overloaded panels. Click any unit to see what feeds it.</div>}
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`sx-attn sx-attn-${it.kind}`}
          onClick={() => {
            if (it.kind === 'approval') onOpenDecisions?.();
            else if (it.nodeId) onFocusNode(it.nodeId);
            else if (it.tags[0]) onFocusTag(it.tags[0]);
            if (it.kind === 'blocked') openInJira.workOrder(it.key);
          }}
          title={it.kind === 'blocked' ? `Open ${it.key} in Jira` : undefined}
        >
          <span className="sx-attn-kind">{KIND[it.kind].icon} {KIND[it.kind].label}{it.key ? ` · ${it.key}` : ''}</span>
          <span className="sx-attn-title">{it.title}</span>
          {it.detail && <span className="sx-muted sx-small">{it.detail}</span>}
          {it.tags.length > 0 && (
            <span className="sx-attn-tags">
              {it.tags.slice(0, 6).map((t) => (
                <span key={t} role="link" tabIndex={0} className="sx-chip" onClick={(e) => { e.stopPropagation(); onFocusTag(t); }}>{t}</span>
              ))}
            </span>
          )}
        </button>
      ))}
      <button type="button" className="sx-disclose" onClick={onShowSystems}>{systemsOpen ? '▾' : '▸'} Systems and layers</button>
      {systemsOpen && children}
    </div>
  );
}

/** One step of the chain diagram: a dot on a vertical line, the node, its key fact. */
function ChainStep({ node, onSelect, last, status }) {
  const [text, fact] = keyFact(node);
  return (
    <li className={`sx-chain-step ${last ? 'sx-chain-last' : ''}`}>
      <span className="sx-chain-dot" style={status ? { background: STATUS_COLOURS[status], boxShadow: `0 0 0 4px ${STATUS_COLOURS[status]}33` } : undefined} />
      <button type="button" className="sx-chain-node" onClick={() => onSelect(node.id)}>
        <span className="sx-muted sx-small">{NODE_TYPES[node.type]?.label ?? node.type}</span>
        <span className="sx-chain-name">{node.name}</span>
        {text && <span className="sx-chain-fact">{text} <ProvenanceChip fact={fact} /></span>}
      </button>
    </li>
  );
}

function LoadBar({ used, total, provenance }) {
  const pct = total ? Math.round((100 * used) / total) : 0;
  const tone = pct >= 80 ? 'hot' : pct >= 60 ? 'warm' : 'ok';
  return (
    <div className="sx-load">
      <div className="sx-load-row"><span>Panel load</span><strong>{pct}%</strong></div>
      <div className="sx-load-track"><div className={`sx-load-fill sx-load-${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="sx-muted sx-small">{used.toLocaleString()} A of breakers on a {total.toLocaleString()} A bus <ProvenanceChip fact={{ provenance }} /></div>
    </div>
  );
}

/** Values on a component, read-only, each with where it came from. */
function Facts({ node, skip = [] }) {
  const rows = Object.entries(node.attrs ?? {}).filter(([k]) => !skip.includes(k) && k !== 'why' && k !== 'ifcGuid');
  if (!rows.length) return null;
  return (
    <div className="sx-facts">
      {rows.map(([k, fact]) => (
        <div key={k} className="sx-fact">
          <span className="sx-muted">{attrLabel(k)}</span>
          <span>{formatValue(k, fact.value)} <ProvenanceChip fact={fact} /></span>
        </div>
      ))}
    </div>
  );
}

/**
 * Right panel in explore mode: the selected component as a card. For equipment: its status, the decisions about it,
 * the work orders on it, where its power comes from (with the panel load), what it serves and what holds it up.
 */
export function NodeCard({ graph, node, status, panelLoad, decisions, orders, onSelectNode, onRecordDecision, actions, onEdit }) {
  const isEquipment = node.type === 'Equipment';
  const ctx = useMemo(() => {
    if (!isEquipment) return null;
    try { return equipmentContext(indexGraph(graph), node.name); } catch { return null; }
  }, [graph, node, isEquipment]);
  const [showSpecs, setShowSpecs] = useState(false);
  const tag = node.name;
  const myDecisions = isEquipment ? decisions.filter((d) => d.equipment?.includes(tag) && ['standing', 'proposed'].includes(d.status)) : [];
  const myOrders = isEquipment ? orders.filter((o) => o.check?.touched?.includes(tag)) : [];
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const neighbours = useMemo(() => {
    const ins = graph.links.filter((l) => l.to === node.id && l.type !== 'locatedOn').map((l) => nodesById.get(l.from)).filter(Boolean);
    const outs = graph.links.filter((l) => l.from === node.id && l.type !== 'locatedOn').map((l) => nodesById.get(l.to)).filter(Boolean);
    return { ins, outs };
  }, [graph, node, nodesById]);
  const a = node.attrs ?? {};
  const weight = a.weightLb;
  const curb = ctx?.support.find((s) => s.type === 'Curb');

  return (
    <div className="sx-card">
      <div className="sx-card-kicker"><SystemDot system={systemOfNode(node) ?? 'other'} /> {NODE_TYPES[node.type]?.label ?? node.type}{a.level?.value ? ` · Level ${a.level.value}` : ''}</div>
      <h3 className="sx-card-title">{node.name}</h3>
      {isEquipment && (a.category || a.model) && (
        <div className="sx-muted">{a.category?.value}{a.manufacturer?.value ? ` · ${a.manufacturer.value}` : ''}{a.model?.value ? ` ${a.model.value}` : ''}</div>
      )}
      {status && <div style={{ marginTop: 8 }}><StatusPill status={status} /></div>}

      {isEquipment && myOrders.filter((o) => o.check?.status === 'conflict').map((o) => (
        <div key={o.key} className="sx-callout sx-callout-red">
          <strong>{o.key} is blocked</strong> <span className="sx-muted">"{o.summary}"</span>
          <div className="sx-small">Conflicts with: {o.check.conflicts[0]?.statement}</div>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => openInJira.workOrder(o.key)}>Open {o.key} to resolve</button>
        </div>
      ))}

      <div className="sx-card-actions">{actions}</div>

      {isEquipment && (
        <>
          <div className="sx-section-title">Decisions <span className="sx-count">{myDecisions.length}</span></div>
          {myDecisions.length === 0 && <div className="sx-empty-note">Nothing decided about {tag} yet.</div>}
          {myDecisions.map((d) => (
            <div key={d.id} className={`sx-decision ${d.status === 'proposed' ? 'sx-decision-proposed' : ''}`}>
              {d.status === 'proposed' && <div className="sx-small" style={{ color: 'var(--sx-purple)' }}>Proposed, awaiting approval</div>}
              <div>{d.statement}</div>
              {d.reason && <div className="sx-muted sx-small">{d.reason}</div>}
              <div className="sx-muted sx-small">{d.guards?.length ? `Guards: ${d.guards.join(', ')}` : 'Any work on it needs review'}</div>
            </div>
          ))}
          <button type="button" className="sx-btn sx-btn-ghost sx-small" onClick={() => onRecordDecision([tag])}>+ Record a decision about {tag}</button>

          {myOrders.length > 0 && (
            <>
              <div className="sx-section-title">Open work orders <span className="sx-count">{myOrders.length}</span></div>
              {myOrders.map((o) => (
                <button key={o.key} type="button" className="sx-wo" onClick={() => openInJira.workOrder(o.key)}>
                  <span className={`sx-wo-dot ${o.check?.status === 'conflict' ? 'sx-wo-blocked' : ''}`} />
                  <strong>{o.key}</strong> <span className="sx-muted">{o.summary}</span>
                </button>
              ))}
            </>
          )}

          <div className="sx-section-title">Power, from the source</div>
          {ctx?.powerChain.length ? (
            <ol className="sx-chain">
              {ctx.powerChain.map((n, i) => <ChainStep key={n.id} node={n} onSelect={onSelectNode} last={i === ctx.powerChain.length - 1} status={n.type === 'Panel' && ctx.panel && ctx.panel.connectedBreakerA / ctx.panel.busA >= 0.8 ? 'capacity' : null} />)}
            </ol>
          ) : <div className="sx-empty-note">No electrical supply mapped yet. <a onClick={onEdit}>Map it</a></div>}
          {ctx?.panel && <LoadBar used={ctx.panel.connectedBreakerA} total={ctx.panel.busA} provenance={ctx.panel.provenance} />}
          {ctx?.panel?.siblings.length > 0 && <div className="sx-muted sx-small" style={{ marginTop: 4 }}>Same panel: {ctx.panel.siblings.join(', ')}</div>}

          {ctx?.serves.length > 0 && (
            <>
              <div className="sx-section-title">Serves</div>
              {ctx.serves.map((s) => <button key={s.id} type="button" className="sx-link-row" onClick={() => onSelectNode(s.id)}>{s.name}</button>)}
            </>
          )}
          {ctx?.connects.length > 0 && (
            <>
              <div className="sx-section-title">Connected to</div>
              {ctx.connects.map((s) => <button key={s.id} type="button" className="sx-link-row" onClick={() => onSelectNode(s.id)}>{s.name}</button>)}
              {ctx.loopMembers.length > 0 && <div className="sx-muted sx-small">Same loop: {ctx.loopMembers.map((m) => m.name).join(', ')}</div>}
            </>
          )}
          {ctx?.support.length > 0 && (
            <>
              <div className="sx-section-title">Held up by</div>
              {ctx.support.map((s) => <button key={s.id} type="button" className="sx-link-row" onClick={() => onSelectNode(s.id)}>{s.name} <span className="sx-muted">{keyFact(s)[0]}</span></button>)}
              {weight && curb?.attrs.loadLimitLb && (
                <div className="sx-muted sx-small">Unit weighs {Number(weight.value).toLocaleString()} lb <ProvenanceChip fact={weight} />: {Math.round((100 * (curb.attrs.loadLimitLb.value - weight.value)) / weight.value)}% spare on its curb.</div>
              )}
            </>
          )}
          <button type="button" className="sx-disclose" onClick={() => setShowSpecs((x) => !x)}>{showSpecs ? '▾' : '▸'} All recorded values</button>
          {showSpecs && <Facts node={node} />}
        </>
      )}

      {!isEquipment && (
        <>
          {panelLoad && <LoadBar used={panelLoad.connectedA} total={panelLoad.busA} provenance={panelLoad.provenance} />}
          {panelLoad?.equipment.length > 0 && <div className="sx-muted sx-small" style={{ marginTop: 4 }}>Feeds {panelLoad.equipment.join(', ')}</div>}
          <Facts node={node} />
          {(neighbours.ins.length > 0 || neighbours.outs.length > 0) && <div className="sx-section-title">Connections</div>}
          {neighbours.ins.map((n) => <button key={`in-${n.id}`} type="button" className="sx-link-row" onClick={() => onSelectNode(n.id)}><span className="sx-muted">from</span> {n.name}</button>)}
          {neighbours.outs.map((n) => <button key={`out-${n.id}`} type="button" className="sx-link-row" onClick={() => onSelectNode(n.id)}><span className="sx-muted">to</span> {n.name}</button>)}
        </>
      )}
    </div>
  );
}

const GUIDE_KEY = 'walkdown.guide.dismissed';
const readDismissed = () => { try { return window.localStorage.getItem(GUIDE_KEY) === '1'; } catch { return false; } };

/**
 * "Try this": three real things to do on this site, built from its own data (the first blocked unit, the first panel
 * near capacity, the main supply), so it works on any site with a mapped graph, not only the sample.
 */
export function Guide({ graph, attention, onFocusTag, onFocusNode, onImpact }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [done, setDone] = useState(() => new Set());
  const steps = useMemo(() => {
    const out = [];
    const blocked = attention.items.find((i) => i.kind === 'blocked');
    if (blocked?.tags[0]) out.push({ id: 'blocked', text: <>See why <strong>{blocked.tags[0]}</strong> is red</>, run: () => onFocusTag(blocked.tags[0]) });
    const capacity = attention.items.find((i) => i.kind === 'capacity');
    if (capacity) out.push({ id: 'capacity', text: <>Find the panel that's <strong>near capacity</strong></>, run: () => onFocusNode(capacity.nodeId) });
    const source = graph.nodes.find((n) => n.type === 'Switchboard') ?? graph.nodes.find((n) => n.type === 'Panel');
    if (source) out.push({ id: 'impact', text: <>What goes dark if <strong>{source.name.split(' ').slice(0, 3).join(' ')}</strong> trips?</>, run: () => onImpact(source.id) });
    return out;
  }, [graph, attention, onFocusTag, onFocusNode, onImpact]);
  if (dismissed || steps.length === 0) return null;
  const close = () => { setDismissed(true); try { window.localStorage.setItem(GUIDE_KEY, '1'); } catch { /* private window */ } };
  return (
    <div className="sx-panel sx-guide">
      <div className="sx-pop-head"><strong>Try this</strong><button type="button" className="sx-x" onClick={close} title="Hide">×</button></div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.id}>
            <button type="button" className={done.has(s.id) ? 'sx-guide-done' : ''} onClick={() => { s.run(); setDone((d) => new Set(d).add(s.id)); }}>
              <span className="sx-guide-n">{done.has(s.id) ? '✓' : i + 1}</span><span>{s.text}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="sx-muted sx-small">Drag to orbit · scroll to zoom · click any unit</div>
    </div>
  );
}
