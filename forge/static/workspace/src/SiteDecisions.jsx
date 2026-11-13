import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Banner, Button, Dialog, Lozenge, Spinner, formatDate } from './ui.jsx';

export const STATUS = {
  standing: ['success', 'Standing'],
  proposed: ['info', 'Awaiting approval'],
  superseded: ['default', 'Superseded'],
  withdrawn: ['default', 'Withdrawn'],
  rejected: ['default', 'Rejected'],
};

/** Site equipment (live from Jira Assets, or the bundled seed when Assets isn't available). */
export function useSiteEquipment(siteId) {
  const [state, setState] = useState({ loading: true, source: null, equipment: [] });
  useEffect(() => {
    api.getSiteEquipment(siteId)
      .then((r) => setState({ loading: false, ...r }))
      .catch(() => setState({ loading: false, source: 'error', equipment: [] }));
  }, [siteId]);
  return state;
}

export function NewDecisionDialog({ site, equipment, pin, initialTags = [], onClose, onCreated }) {
  const [statement, setStatement] = useState('');
  const [reason, setReason] = useState('');
  const [tags, setTags] = useState(initialTags);
  const [freeTags, setFreeTags] = useState('');
  const [guards, setGuards] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (tag) => setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const allTags = [...tags, ...freeTags.split(/[,\s]+/).filter(Boolean)];
      const d = await api.createDecision({
        siteId: site.id, statement, reason, equipment: allTags,
        guards: guards.split(',').map((g) => g.trim()).filter(Boolean), pin,
      });
      onCreated(d);
    } catch (err) {
      setError(String(err?.message ?? err));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Record a decision"
      onClose={onClose}
      footer={<>
        <Button variant="subtle" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || statement.trim().length < 5}>{saving ? 'Saving…' : 'Record decision'}</Button>
      </>}
    >
      {error && <Banner tone="error">{error}</Banner>}
      {pin && <Banner tone="info">Pinned to the spot you selected on the scan <span className="mono">[{pin.point.join(', ')}] m</span>.</Banner>}
      <div className="field">
        <label htmlFor="nd-statement">What was decided</label>
        <textarea id="nd-statement" className="textarea" maxLength={300} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="e.g. Bypass valve V-12 stays locked open until pump P-3 is commissioned." />
      </div>
      <div className="field">
        <label htmlFor="nd-reason">Why</label>
        <textarea id="nd-reason" className="textarea" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="field">
        <label>Equipment this decision governs</label>
        {equipment.length > 0 && (
          <div className="row" style={{ maxHeight: 120, overflow: 'auto' }}>
            {equipment.map((e) => (
              <label key={e.tag} className="row" style={{ gap: 4, fontWeight: 400 }} title={e.serves}>
                <input type="checkbox" checked={tags.includes(e.tag)} onChange={() => toggle(e.tag)} /> {e.tag}
              </label>
            ))}
          </div>
        )}
        <input className="input" value={freeTags} onChange={(e) => setFreeTags(e.target.value)} placeholder={equipment.length ? 'Other tags, comma separated' : 'Equipment tags, e.g. V-12, P-3'} />
      </div>
      <div className="field">
        <label htmlFor="nd-guards">Actions it guards (comma separated)</label>
        <input id="nd-guards" className="input" value={guards} onChange={(e) => setGuards(e.target.value)} placeholder="shut down, isolate, drain" />
        <span className="subtlest">A work order on this equipment that mentions one of these is blocked. Leave empty to require review for any work on it.</span>
      </div>
    </Dialog>
  );
}

export function DecisionsTab({ site, pendingPin, onPinUsed }) {
  const [decisions, setDecisions] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(Boolean(pendingPin));
  const [busyId, setBusyId] = useState(null);
  const eq = useSiteEquipment(site.id);

  const load = () => api.listDecisions(site.id).then(setDecisions).catch((err) => setError(String(err?.message ?? err)));
  useEffect(() => { load(); }, [site.id]);

  async function act(id, fn) {
    setBusyId(id);
    setError(null);
    try { await fn(); await load(); } catch (err) { setError(String(err?.message ?? err)); } finally { setBusyId(null); }
  }

  const byId = Object.fromEntries((decisions ?? []).map((d) => [d.id, d]));
  const order = { proposed: 0, standing: 1, superseded: 2, withdrawn: 3, rejected: 4 };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="subtle">Standing decisions are enforced on work orders in <strong>{site.space?.name ?? 'the linked space'}</strong>.</span>
        <Button variant="primary" onClick={() => setCreating(true)}>Record a decision</Button>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {decisions === null && !error && <Spinner label="Loading decisions…" />}
      {decisions?.length === 0 && (
        <div className="empty"><h2>No decisions yet</h2><p className="subtle">Record what was decided about this place, and which equipment it governs.</p></div>
      )}
      {[...(decisions ?? [])].sort((a, b) => order[a.status] - order[b.status]).map((d) => {
        const [tone, label] = STATUS[d.status] ?? ['default', d.status];
        const replaces = d.supersedes ? byId[d.supersedes] : null;
        return (
          <div key={d.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Lozenge tone={tone}>{label}</Lozenge>
              <span className="subtlest">{d.status === 'proposed' ? 'Proposed' : 'Decided'} {formatDate(d.decidedAt)}{d.originIssueKey ? ` · from ${d.originIssueKey}` : ''}</span>
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 4px' }}>{d.statement}</p>
            {d.reason && <p className="subtle" style={{ margin: '0 0 8px' }}>{d.reason}</p>}
            {replaces && <div className="subtlest">Replaces: "{replaces.statement}"</div>}
            <div className="subtlest">
              Equipment: <strong>{d.equipment.join(', ')}</strong> · {d.guards.length ? <>guards: {d.guards.join(', ')}</> : 'any work needs review'}
              {d.pin && <> · pinned on scan</>}
            </div>
            {['standing', 'proposed'].includes(d.status) && (
              <div className="row" style={{ marginTop: 12 }}>
                {d.status === 'proposed' && (
                  <Button variant="primary" disabled={busyId === d.id} onClick={() => act(d.id, () => api.approveDecision(site.id, d.id))}>Approve</Button>
                )}
                <Button variant="subtle" disabled={busyId === d.id} onClick={() => act(d.id, () => api.withdrawDecision(site.id, d.id))}>
                  {d.status === 'proposed' ? 'Reject' : 'Withdraw'}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {creating && (
        <NewDecisionDialog
          site={site}
          equipment={eq.equipment}
          pin={pendingPin}
          onClose={() => { setCreating(false); onPinUsed?.(); }}
          onCreated={() => { setCreating(false); onPinUsed?.(); load(); }}
        />
      )}
    </div>
  );
}

export function EquipmentTab({ site }) {
  const eq = useSiteEquipment(site.id);
  if (eq.loading) return <Spinner label="Loading equipment from Assets…" />;
  if (!site.equipmentSource) {
    return <Banner tone="info">This site has no equipment register. Decisions can still govern equipment by tag (for example V-12).</Banner>;
  }
  return (
    <div className="stack">
      <div className="subtle">
        {eq.source === 'assets'
          ? <>Live from <strong>Jira Assets</strong> (schema <strong>Walkdown</strong>), imported from the building's as-built COBie.</>
          : <>From the bundled as-built data. Import it into Jira Assets from Diagnostics to manage it there.</>}
      </div>
      <table className="table">
        <thead><tr><th>Tag</th><th>Category</th><th>Level</th><th>Serves</th><th>Manufacturer</th><th>Drawing</th><th>Assets</th></tr></thead>
        <tbody>
          {eq.equipment.map((e) => (
            <tr key={e.tag} title={e.specs}>
              <td><strong>{e.tag}</strong></td><td>{e.category}</td><td>{e.level}</td><td className="subtle">{e.serves}</td>
              <td>{e.manufacturer}</td><td className="subtlest">{e.sourceSheet}</td><td className="mono">{e.objectKey ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
