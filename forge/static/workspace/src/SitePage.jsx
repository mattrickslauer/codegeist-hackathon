import EquipmentGraph from './EquipmentGraph.jsx';
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

// three.js is large; load the viewer only when the model is shown.
const ModelViewer = lazy(() => import('./ModelViewer.jsx'));

/** The 3D model to show: a model bundled with the app (sample building) or the site's latest uploaded scan. */
function modelSourceFor(site) {
  if (site.model?.kind === 'bundled') return { kind: 'bundled', url: `./${site.model.path}` };
  if (site.equipmentSource?.siteName === 'Example Office Building') return { kind: 'bundled', url: './models/exb.glb' }; // sites created before models existed
  const scan = site.scans?.at(-1);
  return scan ? { kind: 'scan', key: scan.key, label: scan.fileName } : null;
}

/** Everything the site screens share: decisions, equipment, open work orders (with their Precedent check). */
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
      <div className="stats" style={{ marginTop: 0, marginBottom: 16 }}>
        <div><div className="stat-value">{data.standing.length}</div><div className="subtlest">standing decisions</div></div>
        <div><div className="stat-value" style={{ color: data.blockedOrders.length ? 'var(--ds-text-danger, #ae2e24)' : undefined }}>{data.blockedOrders.length}</div><div className="subtlest">blocked work orders</div></div>
        <div><div className="stat-value">{data.equipment.equipment.length}</div><div className="subtlest">equipment</div></div>
      </div>

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

function EquipmentDetail({ siteId, tag, data, onBack, onRecord }) {
  const item = data.equipment.equipment.find((e) => e.tag === tag);
  const decisions = (data.decisions ?? []).filter((d) => d.equipment.includes(tag) && ['standing', 'proposed'].includes(d.status));
  const orders = (data.orders ?? []).filter((o) => o.check?.touched?.includes(tag));
  return (
    <div>
      <a onClick={onBack} className="subtle">← All decisions</a>
      <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
        <h2 className="page-title" style={{ fontSize: 22 }}>{tag}</h2>
        <Button variant="primary" onClick={() => onRecord([tag])}>Record a decision about {tag}</Button>
      </div>
      {item ? (
        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
          <div><strong>{item.category}</strong>{item.manufacturer && ` · ${item.manufacturer}`}{item.model && ` ${item.model}`}</div>
          {item.serves && <div className="subtle">Serves: {item.serves}</div>}
          <div className="subtlest">Level {item.level}{item.sourceSheet && ` · drawing ${item.sourceSheet}`}{item.objectKey && ` · Assets ${item.objectKey}`}</div>
          {item.specs && <details style={{ marginTop: 8 }}><summary className="subtle">Specifications</summary><p style={{ fontSize: 13 }}>{item.specs}</p></details>}
        </div>
      ) : <p className="subtle">Not in this site's equipment register.</p>}

      <EquipmentGraph siteId={siteId} tag={tag} />

      <h3 className="card-title">Decisions about {tag}</h3>
      {decisions.length === 0 && <p className="subtle">None yet.</p>}
      {decisions.map((d) => <DecisionRow key={d.id} d={d} />)}

      <h3 className="card-title" style={{ marginTop: 16 }}>Open work orders on {tag}</h3>
      {orders.length === 0 ? <p className="subtle">None.</p> : orders.map((o) => <WorkOrderRow key={o.key} o={o} />)}
    </div>
  );
}

// ---------- Model tab ----------

function ModelTab({ site, data, initialTag }) {
  const source = modelSourceFor(site);
  const [selectedTag, setSelectedTag] = useState(initialTag ?? null);
  const [blob, setBlob] = useState(null);
  const [pin, setPin] = useState(null);
  const [recording, setRecording] = useState(null); // initial tags for the dialog
  const [error, setError] = useState(null);

  useEffect(() => {
    if (source?.kind !== 'scan') return;
    let cancelled = false;
    downloadScan(source.key).then((b) => !cancelled && setBlob(b)).catch((e) => setError(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [source?.key]);

  const viewerSource = source?.kind === 'bundled' ? { url: source.url } : blob ? { blob } : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(320px, 2fr)', gap: 24, alignItems: 'start' }}>
      <div>
        {error && <Banner tone="error">{error}</Banner>}
        {!source && (
          <div className="empty" style={{ height: 520, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h2>No 3D model yet</h2>
            <p className="subtle">Upload a LiDAR scan (GLB) in <strong>Settings</strong>. Decisions still work by equipment tag.</p>
          </div>
        )}
        {source && !viewerSource && <div className="card" style={{ height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner label="Loading model…" /></div>}
        {viewerSource && (
          <Suspense fallback={<div className="card" style={{ height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner label="Loading 3D viewer…" /></div>}>
            <ModelViewer
              source={viewerSource}
              highlights={data.highlights}
              selectedTag={selectedTag}
              onSelectTag={(t) => { setSelectedTag(t); setPin(null); }}
              onPick={(p) => setPin(source.kind === 'scan' ? { scanKey: source.key, ...p } : null)}
              onError={(e) => setError(`Couldn't render the model: ${String(e?.message ?? e)}`)}
            />
          </Suspense>
        )}
        <div className="row subtlest" style={{ justifyContent: 'space-between', marginTop: 8 }}>
          <span className="row" style={{ gap: 12 }}>
            <span><span style={{ color: '#388bff' }}>■</span> has decisions</span>
            <span><span style={{ color: '#e2483d' }}>■</span> blocked work order</span>
          </span>
          <span>Click equipment to select · drag to orbit · scroll to zoom</span>
        </div>
        {pin && (
          <Banner tone="info">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Selected a spot on the scan</span>
              <Button variant="primary" onClick={() => setRecording([])}>Record a decision here</Button>
            </div>
          </Banner>
        )}
      </div>
      <div>
        {data.error && <Banner tone="error">{data.error}</Banner>}
        {selectedTag
          ? <EquipmentDetail siteId={site.id} tag={selectedTag} data={data} onBack={() => setSelectedTag(null)} onRecord={setRecording} />
          : <Overview site={site} data={data} onSelectTag={setSelectedTag} onRecord={setRecording} onChanged={data.reload} />}
      </div>
      {recording && (
        <NewDecisionDialog
          site={site}
          equipment={data.equipment.equipment}
          initialTags={recording}
          pin={pin}
          onClose={() => setRecording(null)}
          onCreated={() => { setRecording(null); setPin(null); data.reload(); }}
        />
      )}
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
          <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Precedent</th><th>Equipment</th><th>Updated</th></tr></thead>
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

const TABS = [['model', 'Model'], ['work-orders', 'Work orders'], ['settings', 'Settings']];

function SiteScreens({ site, setSite, initialTag }) {
  const [tab, setTab] = useState('model');
  const data = useSiteData(site);
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{site.name}</h1>
          {site.description && <div className="subtle">{site.description}</div>}
        </div>
        <div className="stack" style={{ alignItems: 'flex-end' }}>
          <SpaceChip space={site.space} onClick={site.space ? () => openInJira.space(site.space.key) : undefined} />
          {data.blockedOrders.length > 0 && <Lozenge tone="bold-danger">{data.blockedOrders.length} blocked</Lozenge>}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'tab-active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'model' && <ModelTab site={site} data={data} initialTag={initialTag} />}
      {tab === 'work-orders' && <WorkOrdersTab site={site} data={data} />}
      {tab === 'settings' && <SettingsTab site={site} onSiteChange={setSite} />}
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
