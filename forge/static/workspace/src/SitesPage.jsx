import { useEffect, useState } from 'react';
import { api, blockedWorkOrdersJql, countJql, listSpaces, openWorkOrdersJql } from './api.js';
import { navigate } from './router.js';
import { Banner, Button, Dialog, SpaceChip, Spinner } from './ui.jsx';
import './site.css';

/** A real render of the sample building's Building view, shipped with the app (regenerate from the mock preview). */
const SAMPLE_PREVIEW = './models/exb-preview.jpg';

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
    if (!spaceKey) return undefined;
    let cancelled = false;
    Promise.all([countJql(openWorkOrdersJql(spaceKey)), countJql(blockedWorkOrdersJql(spaceKey))])
      .then(([open, blocked]) => !cancelled && setCounts({ open, blocked }));
    return () => { cancelled = true; };
  }, [spaceKey]);
  return counts;
}

const isSample = (site) => site.model?.path === 'models/exb.glb' || site.equipmentSource?.siteName === 'Example Office Building';
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function SiteArt({ site, blocked }) {
  return (
    <div className="site-art">
      {isSample(site) ? <img src={SAMPLE_PREVIEW} alt="" /> : <><div className="site-art-grid" /><div className="site-art-initials">{initials(site.name)}</div></>}
      <div className="site-badges">
        {blocked > 0 && <span className="site-badge site-badge-danger">{blocked} blocked</span>}
        {blocked === 0 && <span className="site-badge site-badge-ok">All clear</span>}
        {site.scans?.length > 0 && <span className="site-badge">{site.scans.length} scan{site.scans.length === 1 ? '' : 's'}</span>}
      </div>
    </div>
  );
}

function SiteCard({ site, spacesByKey }) {
  const space = site.space ? { ...site.space, avatarUrl: spacesByKey[site.space.key]?.avatarUrl } : null;
  const counts = useSpaceCounts(site.space?.key);
  const show = (n) => (n === undefined ? '…' : n === null ? '–' : n);
  return (
    <button type="button" className="site-card" onClick={() => navigate(`/sites/${encodeURIComponent(site.id)}`)}>
      <SiteArt site={site} blocked={counts.blocked} />
      <div className="site-body">
        <div className="site-name">{site.name}</div>
        {site.description && <div className="subtle">{site.description}</div>}
        <SpaceChip space={space} />
        <div className="site-meta">
          <span><strong>{show(counts.open)}</strong> open work orders</span>
          <span><strong>{show(counts.blocked)}</strong> blocked</span>
        </div>
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
        <span className="subtlest">Walkdown checks work orders in this space against the site's decisions.</span>
      </div>
      <p className="subtle" style={{ marginBottom: 0 }}>Next, you can map its equipment and systems on the Building tab, upload a LiDAR scan in Settings, and record decisions.</p>
    </Dialog>
  );
}

const STEPS = [
  ['#0C66E4', 'See the building', 'Every unit on the 3D model, what feeds it, what it serves and what holds it up, each fact labelled with where it came from.'],
  ['#C9372C', 'Every work order is checked', 'Record what was decided about a unit and why. A work order that contradicts it is flagged and blocked until someone resolves it.'],
  ['#B65C02', 'Ask before anyone climbs the roof', '“What if this panel trips?” “What do I close to isolate this unit?” See what goes dark, and which standing decisions it touches.'],
];

function FirstRun({ loading, onLoadSample, onCreate }) {
  return (
    <div className="hero">
      <div>
        <h2>The pre-quote walkdown, before anyone climbs the roof</h2>
        <p className="subtle" style={{ fontSize: 15, lineHeight: '22px', margin: 0 }}>
          Walkdown keeps what a technician needs to know about a building's equipment next to the Jira work orders that touch it.
        </p>
        <ol className="hero-steps">
          {STEPS.map(([colour, title, text], i) => (
            <li key={title}>
              <span className="n" style={{ background: colour }}>{i + 1}</span>
              <span><strong>{title}</strong><br /><span className="subtle">{text}</span></span>
            </li>
          ))}
        </ol>
        <div className="row">
          <Button variant="primary" onClick={onLoadSample} disabled={loading}>{loading ? 'Loading the sample building…' : 'Explore the sample building'}</Button>
          <Button onClick={onCreate}>Set up your own site</Button>
        </div>
        <p className="subtlest" style={{ marginTop: 10 }}>The sample is a real, anonymised five-storey office building with 28 pieces of rooftop plant. Its electrical and structural details are illustrative and labelled as such.</p>
      </div>
      <div className="hero-art"><img src={SAMPLE_PREVIEW} alt="The sample building in Walkdown: equipment coloured by status, power runs glowing" /></div>
    </div>
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

  async function loadSample() {
    setLoadingSample(true);
    setError(null);
    try {
      const { site } = await api.loadSampleBuilding(pickSampleSpace(spaces));
      navigate(`/sites/${encodeURIComponent(site.id)}`);
    } catch (err) {
      setError(String(err?.message ?? err));
      setLoadingSample(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Sites</h1>
          <div className="subtle">Buildings and plants, what's decided about their equipment, and the work orders those decisions guard.</div>
        </div>
        {sites?.length > 0 && (
          <div className="row">
            {!sites.some(isSample) && <Button onClick={loadSample} disabled={loadingSample}>{loadingSample ? 'Loading…' : 'Add the sample building'}</Button>}
            <Button variant="primary" onClick={() => setCreating(true)}>New site</Button>
          </div>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {sites === null && !error && <Spinner label="Loading sites…" />}
      {sites?.length === 0 && <FirstRun loading={loadingSample} onLoadSample={loadSample} onCreate={() => setCreating(true)} />}
      {sites?.length > 0 && (
        <div className="site-grid">
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
