import { useEffect, useState } from 'react';
import { api, blockedWorkOrdersJql, countJql, listSpaces, openWorkOrdersJql } from './api.js';
import { navigate } from './router.js';
import { Banner, Button, Dialog, Lozenge, SpaceChip, Spinner, formatDate } from './ui.jsx';

/** Prefer a Facilities-style service space for the sample site; otherwise the first service space; otherwise any. */
function pickSampleSpace(spaces) {
  return spaces.find((s) => /facilit/i.test(s.name))
    ?? spaces.find((s) => s.projectTypeKey === 'service_desk')
    ?? spaces[0]
    ?? null;
}

/** Live work-order counts for a site's Jira space (as the user). */
function useSpaceCounts(spaceKey) {
  const [counts, setCounts] = useState({ open: undefined, blocked: undefined });
  useEffect(() => {
    if (!spaceKey) return;
    let cancelled = false;
    Promise.all([countJql(openWorkOrdersJql(spaceKey)), countJql(blockedWorkOrdersJql(spaceKey))])
      .then(([open, blocked]) => !cancelled && setCounts({ open, blocked }));
    return () => { cancelled = true; };
  }, [spaceKey]);
  return counts;
}

function SiteCard({ site, spacesByKey }) {
  const space = site.space ? { ...site.space, avatarUrl: spacesByKey[site.space.key]?.avatarUrl } : null;
  const counts = useSpaceCounts(site.space?.key);
  const latest = site.scans?.at(-1);
  const show = (n) => (n === undefined ? '…' : n === null ? '–' : n);
  return (
    <button type="button" className="card card-link" onClick={() => navigate(`/sites/${encodeURIComponent(site.id)}`)}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="card-title">{site.name}</h3>
        {counts.blocked > 0 && <Lozenge tone="bold-danger">{counts.blocked} blocked</Lozenge>}
      </div>
      {site.description && <p className="subtle" style={{ margin: '0 0 12px' }}>{site.description}</p>}
      <SpaceChip space={space} />
      <div className="stats">
        <div><div className="stat-value">{site.scans?.length ?? 0}</div><div className="subtlest">scans</div></div>
        <div><div className="stat-value">{show(counts.open)}</div><div className="subtlest">open work orders</div></div>
        <div><div className="stat-value">{show(counts.blocked)}</div><div className="subtlest">blocked</div></div>
      </div>
      <div className="subtlest" style={{ marginTop: 12 }}>
        {latest ? `Latest scan ${formatDate(latest.uploadedAt)}` : 'No scan yet'}
      </div>
    </button>
  );
}

function NewSiteDialog({ spaces, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [spaceKey, setSpaceKey] = useState(pickSampleSpace(spaces)?.key ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const space = spaces.find((s) => s.key === spaceKey) ?? null;
      const site = await api.createSite({ name, description, space });
      onCreated(site);
    } catch (err) {
      setError(String(err?.message ?? err));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="New site"
      onClose={onClose}
      footer={<>
        <Button variant="subtle" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create site'}</Button>
      </>}
    >
      {error && <Banner tone="error">{error}</Banner>}
      <div className="field">
        <label htmlFor="site-name">Name</label>
        <input id="site-name" className="input" value={name} maxLength={80} autoFocus placeholder="e.g. North Plant Room" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="site-description">Description</label>
        <textarea id="site-description" className="textarea" value={description} maxLength={500} placeholder="What and where this place is" onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="site-space">Jira space for this site's work orders</label>
        <select id="site-space" className="select" value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)}>
          <option value="">No space yet</option>
          {spaces.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
        </select>
        <span className="subtlest">Precedent checks work orders in this space against the site's decisions.</span>
      </div>
    </Dialog>
  );
}

export default function SitesPage() {
  const [sites, setSites] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  useEffect(() => {
    api.listSites().then(setSites).catch((err) => setError(String(err?.message ?? err)));
    listSpaces().then(setSpaces).catch(() => setSpaces([]));
  }, []);

  const spacesByKey = Object.fromEntries(spaces.map((s) => [s.key, s]));

  /** kind: 'building' (EXB office building + decisions) or 'scan' (North Plant Room LiDAR scan). */
  async function loadSample(kind = 'building') {
    setLoadingSample(true);
    setError(null);
    try {
      const space = pickSampleSpace(spaces);
      const { site } = kind === 'building' ? await api.loadSampleBuilding(space) : await api.loadSampleSite(space);
      navigate(`/sites/${encodeURIComponent(site.id)}`);
    } catch (err) {
      setError(String(err?.message ?? err));
      setLoadingSample(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sites</h1>
          <div className="subtle">Buildings and plants, the decisions made about their equipment, and the work orders those decisions guard.</div>
        </div>
        {sites?.length > 0 && (
          <div className="row">
            <Button onClick={() => loadSample('building')} disabled={loadingSample}>{loadingSample ? 'Loading…' : 'Load sample building'}</Button>
            <Button variant="primary" onClick={() => setCreating(true)}>New site</Button>
          </div>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {sites === null && !error && <Spinner label="Loading sites…" />}

      {sites?.length === 0 && (
        <div className="empty">
          <h2>Every decision about a building, enforced on every work order</h2>
          <p className="subtle" style={{ maxWidth: 560, margin: '0 auto 16px' }}>
            Record what was decided about a piece of equipment, and why. When a work order in the linked Jira space contradicts it,
            Precedent blocks it from starting until someone reaffirms, supersedes or withdraws it.
            Start with the sample: a real five-storey office building with its rooftop plant.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="primary" onClick={() => loadSample('building')} disabled={loadingSample}>{loadingSample ? 'Loading…' : 'Load sample building'}</Button>
            <Button onClick={() => setCreating(true)}>Create your own site</Button>
          </div>
        </div>
      )}

      {sites?.length > 0 && (
        <div className="grid">
          {sites.map((site) => <SiteCard key={site.id} site={site} spacesByKey={spacesByKey} />)}
        </div>
      )}

      {creating && (
        <NewSiteDialog
          spaces={spaces}
          onClose={() => setCreating(false)}
          onCreated={(site) => navigate(`/sites/${encodeURIComponent(site.id)}`)}
        />
      )}
    </div>
  );
}
