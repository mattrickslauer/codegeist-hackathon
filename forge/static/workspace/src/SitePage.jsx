import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api, blockedWorkOrdersJql, downloadScan, listSpaces, listWorkOrders, openInJira, uploadScanToSite,
} from './api.js';
import { navigate } from './router.js';
import {
  Banner, Button, Dialog, Lozenge, SpaceChip, Spinner, StatusLozenge, formatBytes, formatDate,
} from './ui.jsx';
import { EquipmentTab, NewDecisionDialog, STATUS, useSiteEquipment } from './SiteDecisions.jsx';
import { deriveSiteState } from './siteState.js';
import './site.css';

// three.js is large; load the Building view only when shown.
const SystemsWorkspace = lazy(() => import('./systems/SystemsWorkspace.jsx'));

/** The 3D model to show: a model bundled with the app (sample building) or the site's latest uploaded scan. */
function modelSourceFor(site) {
  if (site.model?.kind === 'bundled') return { kind: 'bundled', url: `./${site.model.path}` };
  if (site.equipmentSource?.siteName === 'Example Office Building') return { kind: 'bundled', url: './models/exb.glb' }; // sites created before models existed
  const scan = site.scans?.at(-1);
  return scan ? { kind: 'scan', key: scan.key, label: scan.fileName } : null;
}

/** The model ready for a viewer: { url } for a bundled model, { blob } once a scan has downloaded, else null. */
function useViewerSource(site) {
  const source = modelSourceFor(site);
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (source?.kind !== 'scan') return undefined;
    let cancelled = false;
    downloadScan(source.key).then((b) => !cancelled && setBlob(b)).catch((e) => setError(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [source?.key]);
  const viewerSource = useMemo(() => (source?.kind === 'bundled' ? { url: source.url } : blob ? { blob } : null), [source?.url, blob]);
  return { source, viewerSource, error };
}

/** Everything the site screens share: decisions, equipment, open work orders (with their Walkdown check). */
function useSiteData(site) {
  const [decisions, setDecisions] = useState(null);
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const equipment = useSiteEquipment(site.id);

  const reload = useCallback(() => {
    setError(null);
    api.listDecisions(site.id).then(setDecisions).catch((e) => setError(String(e?.message ?? e)));
    if (site.space) listWorkOrders(site.space.key, 50).then(setOrders).catch(() => setOrders([]));
    else setOrders([]);
  }, [site.id, site.space?.key]);
  useEffect(reload, [reload]);

  const derived = useMemo(() => deriveSiteState(decisions, orders), [decisions, orders]);

  return { decisions, orders, equipment, error, reload, ...derived };
}

// ---------- Side panel ----------

function DecisionRow({ d, onSelectTag, actions }) {
  const [tone, label] = STATUS[d.status] ?? ['default', d.status];
  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Lozenge tone={tone}>{label}</Lozenge>
        <span className="subtlest">{formatDate(d.decidedAt)}</span>
      </div>
      <div style={{ fontWeight: 600, margin: '6px 0 4px' }}>{d.statement}</div>
      {d.reason && <div className="subtle" style={{ fontSize: 13 }}>{d.reason}</div>}
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        {d.equipment.map((t) => <a key={t} onClick={() => onSelectTag?.(t)}><Lozenge tone="info">{t}</Lozenge></a>)}
        <span className="subtlest">{d.guards.length ? `guards: ${d.guards.join(', ')}` : 'any work needs review'}</span>
      </div>
      {actions && <div className="row" style={{ marginTop: 8 }}>{actions}</div>}
    </div>
  );
}

function WorkOrderRow({ o }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--ds-border, #091e4224)' }}>
      <span><a onClick={() => openInJira.workOrder(o.key)}>{o.key}</a> <span className="subtle">{o.summary}</span></span>
      {o.check?.status === 'conflict' ? <Lozenge tone="bold-danger">Blocked</Lozenge> : <StatusLozenge name={o.status} category={o.statusCategory} />}
    </div>
  );
}

function Overview({ site, data, onSelectTag, onRecord, onChanged }) {
  const [busy, setBusy] = useState(null);
  const proposed = (data.decisions ?? []).filter((d) => d.status === 'proposed');
  const act = async (id, fn) => { setBusy(id); try { await fn(); onChanged(); } finally { setBusy(null); } };
  return (
    <div>
      {proposed.length > 0 && (
        <>
          <h3 className="card-title">Awaiting approval</h3>
          {proposed.map((d) => (
            <DecisionRow key={d.id} d={d} onSelectTag={onSelectTag} actions={<>
              <Button variant="primary" disabled={busy === d.id} onClick={() => act(d.id, () => api.approveDecision(site.id, d.id))}>Approve</Button>
              <Button variant="subtle" disabled={busy === d.id} onClick={() => act(d.id, () => api.withdrawDecision(site.id, d.id))}>Reject</Button>
            </>} />
          ))}
        </>
      )}

      {data.blockedOrders.length > 0 && (
        <>
          <h3 className="card-title">Blocked work orders</h3>
          <div style={{ marginBottom: 16 }}>{data.blockedOrders.map((o) => <WorkOrderRow key={o.key} o={o} />)}</div>
        </>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="card-title">Standing decisions</h3>
        <Button variant="primary" onClick={() => onRecord([])}>Record a decision</Button>
      </div>
      {data.decisions === null && <Spinner label="Loading decisions…" />}
      {data.standing.length === 0 && data.decisions !== null && <p className="subtle">No decisions yet. Click equipment in the model to record one about it.</p>}
      {data.standing.map((d) => <DecisionRow key={d.id} d={d} onSelectTag={onSelectTag} />)}
    </div>
  );
}

// ---------- Decisions tab ----------

/** Every decision at the site as a list: approvals first, then blocked work orders, standing, and history. */
function DecisionsTab({ site, data, onSelectTag, onRecord }) {
  const history = (data.decisions ?? []).filter((d) => ['superseded', 'withdrawn', 'rejected'].includes(d.status));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 1fr)', gap: 32, alignItems: 'start' }}>
      <div>
        {data.error && <Banner tone="error">{data.error}</Banner>}
        <Overview site={site} data={data} onSelectTag={onSelectTag} onRecord={onRecord} onChanged={data.reload} />
        {history.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary className="subtle">History: {history.length} superseded, withdrawn or rejected</summary>
            <div style={{ marginTop: 8 }}>{history.map((d) => <DecisionRow key={d.id} d={d} onSelectTag={onSelectTag} />)}</div>
          </details>
        )}
      </div>
      <aside className="card" style={{ padding: 16 }}>
        <h3 className="card-title" style={{ marginTop: 0 }}>How decisions work</h3>
        <ol className="subtle" style={{ paddingLeft: 18, margin: 0, lineHeight: '20px' }}>
          <li>Record what was decided about a unit, and why. Optionally list the actions it guards (“shut down”).</li>
          <li>Every work order in <strong>{site.space?.name ?? 'the linked space'}</strong> that names the unit is checked when it’s created or edited.</li>
          <li>A conflict blocks the work order from starting until someone reaffirms, supersedes (with an approver) or withdraws it.</li>
        </ol>
      </aside>
    </div>
  );
}

// ---------- Work orders tab ----------

function WorkOrdersTab({ site, data }) {
  if (!site.space) return <Banner tone="warning">Link a Jira space in <strong>Settings</strong> to see this site's work orders.</Banner>;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="subtle">Open work orders in <strong>{site.space.name || site.space.key}</strong>, most recently updated first. Each is checked against this site's standing decisions when it's created or edited.</span>
        <div className="row">
          <Button onClick={() => openInJira.search(blockedWorkOrdersJql(site.space.key))}>Blocked in Jira search</Button>
          <Button onClick={() => openInJira.space(site.space.key)}>Open space</Button>
        </div>
      </div>
      {data.orders === null && <Spinner label="Loading work orders…" />}
      {data.orders?.length === 0 && <div className="empty"><h2>No open work orders</h2></div>}
      {data.orders?.length > 0 && (
        <table className="table">
          <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Walkdown</th><th>Equipment</th><th>Updated</th></tr></thead>
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.key}>
                <td><a onClick={() => openInJira.workOrder(o.key)}>{o.key}</a></td>
                <td>{o.summary}</td>
                <td><StatusLozenge name={o.status} category={o.statusCategory} /></td>
                <td>
                  {o.check?.status === 'conflict' && <span title={o.check.summary}><Lozenge tone="bold-danger">Blocked</Lozenge></span>}
                  {o.check?.status === 'clear' && <Lozenge tone="success">Clear</Lozenge>}
                  {!o.check && <span className="subtlest">Not checked</span>}
                </td>
                <td className="subtle">{o.check?.touched?.join(', ') || '–'}</td>
                <td className="subtle">{formatDate(o.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Settings tab ----------

function ScansSection({ site, onSiteChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);
  async function upload(file) {
    setUploading(true);
    setError(null);
    try { onSiteChange(await uploadScanToSite(site.id, file)); } catch (e) { setError(String(e?.message ?? e)); } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 className="card-title">LiDAR scans</h3>
      <p className="subtle">Scan the space with a LiDAR app on an iPhone or iPad Pro (for example Scaniverse, mesh mode) and upload the <strong>GLB</strong>. {site.model ? 'This site shows its building model; scans are kept as evidence.' : 'The latest scan becomes the site model.'}</p>
      {error && <Banner tone="error">{error}</Banner>}
      {(site.scans ?? []).map((s) => <div key={s.key} className="subtle">{s.fileName} · {formatDate(s.uploadedAt)} · {formatBytes(s.size)}</div>)}
      <input ref={fileInput} type="file" accept=".glb,model/gltf-binary" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <div style={{ marginTop: 8 }}><Button onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload scan (GLB)'}</Button></div>
    </div>
  );
}

function DetailsSection({ site, onSiteChange }) {
  const [spaces, setSpaces] = useState([]);
  const [name, setName] = useState(site.name);
  const [description, setDescription] = useState(site.description ?? '');
  const [spaceKey, setSpaceKey] = useState(site.space?.key ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { listSpaces().then(setSpaces).catch(() => setSpaces([])); }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const space = spaceKey ? (spaces.find((s) => s.key === spaceKey) ?? site.space) : null;
      onSiteChange(await api.updateSite({ id: site.id, name, description, space }));
      setMessage({ tone: 'info', text: 'Saved.' });
    } catch (e) {
      setMessage({ tone: 'error', text: String(e?.message ?? e) });
    } finally { setSaving(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 className="card-title">Site details</h3>
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      <div className="field"><label htmlFor="d-name">Name</label><input id="d-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="d-desc">Description</label><textarea id="d-desc" className="textarea" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="field">
        <label htmlFor="d-space">Jira space whose work orders this site guards</label>
        <select id="d-space" className="select" value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)}>
          <option value="">No space</option>
          {spaces.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
          {site.space && !spaces.some((s) => s.key === site.space.key) && <option value={site.space.key}>{site.space.name || site.space.key}</option>}
        </select>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save changes'}</Button>
        <Button variant="subtle" onClick={() => setConfirmDelete(true)}>Delete site…</Button>
      </div>
      {confirmDelete && (
        <Dialog title={`Delete ${site.name}?`} onClose={() => setConfirmDelete(false)} footer={<>
          <Button variant="subtle" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { await api.deleteSite(site.id); navigate('/'); }}>Delete site</Button>
        </>}>
          <p>This removes the site and stops enforcing its decisions. The Jira space, work orders and Assets records are not affected.</p>
        </Dialog>
      )}
    </div>
  );
}

function SettingsTab({ site, onSiteChange }) {
  return (
    <div style={{ maxWidth: 900 }}>
      <DetailsSection site={site} onSiteChange={onSiteChange} />
      <ScansSection site={site} onSiteChange={onSiteChange} />
      <div className="card">
        <h3 className="card-title">Equipment register</h3>
        <EquipmentTab site={site} />
      </div>
    </div>
  );
}

// ---------- Page ----------

const TABS = [['building', 'Building'], ['decisions', 'Decisions'], ['work-orders', 'Work orders'], ['settings', 'Settings']];

function BuildingTab({ site, data, initialTag, onRecord, onOpenDecisions }) {
  const { viewerSource, source, error } = useViewerSource(site);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (source && !viewerSource) return <div className="card" style={{ height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner label="Loading model…" /></div>;
  return (
    <Suspense fallback={<div className="card" style={{ height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner label="Loading the building…" /></div>}>
      <SystemsWorkspace
        key={initialTag ?? ''}
        site={site}
        source={viewerSource}
        decisions={data.decisions ?? []}
        orders={data.orders ?? []}
        initialTag={initialTag}
        onRecordDecision={(tags, point) => onRecord(tags, point && source?.kind === 'scan' ? { scanKey: source.key, point } : null)}
        onOpenDecisions={onOpenDecisions}
      />
    </Suspense>
  );
}

function HeaderStats({ data }) {
  const proposed = (data.decisions ?? []).filter((d) => d.status === 'proposed').length;
  const stat = (n, label, tone) => (
    <div className={`hstat ${tone && n ? `hstat-${tone}` : ''}`}><span className="hstat-n">{n}</span><span className="hstat-l">{label}</span></div>
  );
  return (
    <div className="hstats">
      {stat(data.blockedOrders.length, 'blocked', 'danger')}
      {stat(proposed, 'to approve', 'discovery')}
      {stat(data.standing.length, 'standing decisions')}
      {stat((data.orders ?? []).length, 'open work orders')}
    </div>
  );
}

function SiteScreens({ site, setSite, initialTag }) {
  const [tab, setTab] = useState('building');
  const [buildingTag, setBuildingTag] = useState(initialTag ?? null);
  const [recording, setRecording] = useState(null); // { tags, pin }
  const data = useSiteData(site);
  const showOnBuilding = (tag) => { setBuildingTag(tag); setTab('building'); };
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{site.name}</h1>
          {site.description && <div className="subtle">{site.description}</div>}
          <div style={{ marginTop: 8 }}><SpaceChip space={site.space} onClick={site.space ? () => openInJira.space(site.space.key) : undefined} /></div>
        </div>
        <HeaderStats data={data} />
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'tab-active' : ''}`} onClick={() => setTab(key)}>
            {label}
            {key === 'decisions' && (data.decisions ?? []).some((d) => d.status === 'proposed') && <span className="tab-dot" title="Awaiting approval" />}
          </button>
        ))}
      </div>
      {tab === 'building' && <BuildingTab site={site} data={data} initialTag={buildingTag} onRecord={(tags, pin) => setRecording({ tags, pin })} onOpenDecisions={() => setTab('decisions')} />}
      {tab === 'decisions' && <DecisionsTab site={site} data={data} onSelectTag={showOnBuilding} onRecord={(tags) => setRecording({ tags, pin: null })} />}
      {tab === 'work-orders' && <WorkOrdersTab site={site} data={data} />}
      {tab === 'settings' && <SettingsTab site={site} onSiteChange={setSite} />}
      {recording && (
        <NewDecisionDialog
          site={site}
          equipment={data.equipment.equipment}
          initialTags={recording.tags}
          pin={recording.pin}
          onClose={() => setRecording(null)}
          onCreated={() => { setRecording(null); data.reload(); }}
        />
      )}
    </>
  );
}

export default function SitePage({ id, equipment }) {
  const [site, setSite] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    setSite(null);
    api.getSite(id).then(setSite).catch((e) => setError(String(e?.message ?? e)));
  }, [id]);
  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="breadcrumbs"><a onClick={() => navigate('/')}>Sites</a>{site && <> / {site.name}</>}</div>
      {error && <Banner tone="error">{error}</Banner>}
      {!site && !error && <Spinner label="Loading site…" />}
      {site && <SiteScreens site={site} setSite={setSite} initialTag={equipment} />}
    </div>
  );
}
