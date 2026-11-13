import { useEffect, useState } from 'react';
import { router } from '@forge/bridge';
import { api } from './api.js';
import { Banner, Button, Lozenge, Spinner, formatDate } from './ui.jsx';
import { normaliseCheck } from './siteState.js';

/** Accept a check result from the backend: keep 'unlinked' as-is, normalise everything else. */
const acceptCheck = (r) => (r?.status === 'unlinked' ? r : normaliseCheck(r));

/**
 * The Walkdown panel on a Jira work order (jira:issuePanel).
 * Runs the check, shows detected equipment and any conflicting standing decisions, and lets the user
 * reaffirm (with a reason), propose a superseding decision (needs an approver), or withdraw (edit the work order).
 */
function ConflictCard({ issueKey, conflict, onChanged }) {
  const [mode, setMode] = useState(null); // 'reaffirm' | 'supersede' | 'withdraw'
  const [reason, setReason] = useState('');
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reaffirm') {
        onChanged(await api.reaffirmConflict({ issueKey, siteId: conflict.siteId, decisionId: conflict.decisionId, reason }));
      } else if (mode === 'supersede') {
        await api.proposeSupersession({ issueKey, siteId: conflict.siteId, decisionId: conflict.decisionId, statement, reason });
        setDone('Proposed. The work order stays blocked until a site approver accepts the new decision in Walkdown → site → Decisions.');
        setMode(null);
      }
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--ds-border-danger, #e2483d)', marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Lozenge tone="bold-danger">Conflicts with a standing decision</Lozenge>
        <span className="subtlest">Decided {formatDate(conflict.decidedAt)}</span>
      </div>
      <p style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 4px' }}>"{conflict.statement}"</p>
      {conflict.reason && <p className="subtle" style={{ margin: '0 0 8px' }}>{conflict.reason}</p>}
      <div className="subtlest">
        <a onClick={() => router.navigate({ target: 'module', moduleKey: 'walkdown-workspace', path: `/sites/${encodeURIComponent(conflict.siteId)}?equipment=${encodeURIComponent(conflict.matched[0])}` })}>
          View on model
        </a>{' · '}
        Equipment: <strong>{conflict.matched.join(', ')}</strong>
        {conflict.guardsMatched.length > 0 && <> · guarded action: <strong>{conflict.guardsMatched.join(', ')}</strong></>}
        {conflict.guardsMatched.length === 0 && <> · any work on this equipment needs review</>}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {done && <Banner tone="info">{done}</Banner>}
      {!mode && !done && (
        <div className="row" style={{ marginTop: 12 }}>
          <Button onClick={() => setMode('reaffirm')}>Reaffirm…</Button>
          <Button onClick={() => setMode('supersede')}>Supersede…</Button>
          <Button variant="subtle" onClick={() => setMode('withdraw')}>Withdraw</Button>
        </div>
      )}
      {mode === 'reaffirm' && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor={`r-${conflict.decisionId}`}>Why is this work order consistent with the decision?</label>
            <textarea id={`r-${conflict.decisionId}`} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scheduled for Saturday 06:00, outside the protected hours" />
          </div>
          <div className="row"><Button variant="primary" onClick={submit} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Reaffirm and unblock'}</Button><Button variant="subtle" onClick={() => setMode(null)}>Cancel</Button></div>
        </div>
      )}
      {mode === 'supersede' && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor={`s-${conflict.decisionId}`}>New decision (replaces the old one once approved)</label>
            <textarea id={`s-${conflict.decisionId}`} className="textarea" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="e.g. RTU-1 may be shut down on weekdays after 19:00 with 48 hours' notice to tenants." />
          </div>
          <div className="field">
            <label htmlFor={`sr-${conflict.decisionId}`}>Reason for the change</label>
            <textarea id={`sr-${conflict.decisionId}`} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="row"><Button variant="primary" onClick={submit} disabled={busy || statement.trim().length < 5}>{busy ? 'Proposing…' : 'Propose for approval'}</Button><Button variant="subtle" onClick={() => setMode(null)}>Cancel</Button></div>
        </div>
      )}
      {mode === 'withdraw' && (
        <Banner tone="info">
          Edit this work order so it no longer conflicts (for example change the action or the equipment). Walkdown re-checks automatically when you save.
          {' '}<a onClick={() => setMode(null)}>OK</a>
        </Banner>
      )}
    </div>
  );
}

export default function WorkOrderPanel({ issueKey }) {
  const [check, setCheckRaw] = useState(null);
  const setCheck = (r) => setCheckRaw(acceptCheck(r));
  const [error, setError] = useState(null);
  const [editingTags, setEditingTags] = useState(false);
  const [tagText, setTagText] = useState('');

  const load = () => {
    setError(null);
    api.checkWorkOrder(issueKey).then(setCheck).catch((err) => setError(String(err?.message ?? err)));
  };
  useEffect(load, [issueKey]);

  async function saveTags() {
    try {
      const tags = tagText.split(/[,\s]+/).filter(Boolean);
      setCheck(await api.setWorkOrderEquipment(issueKey, tags));
      setEditingTags(false);
    } catch (err) {
      setError(String(err?.message ?? err));
    }
  }

  if (error) return <div style={{ padding: 8 }}><Banner tone="error">{error}</Banner><Button onClick={load}>Retry</Button></div>;
  if (!check) return <div style={{ padding: 8 }}><Spinner label="Checking against site decisions…" /></div>;

  if (check.status === 'unlinked') {
    return (
      <div style={{ padding: 8 }} className="subtle">
        No Walkdown site is linked to this space ({check.projectKey}). Link one in <a onClick={() => router.navigate('/jira/apps')}>Walkdown</a> → site → Details.
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        {check.status === 'conflict'
          ? <Lozenge tone="bold-danger">Blocked by Walkdown</Lozenge>
          : <Lozenge tone="success">Clear to start</Lozenge>}
        <span className="subtlest">Checked {new Date(check.checkedAt).toLocaleTimeString()} · <a onClick={load}>Re-check</a></span>
      </div>

      <div className="subtle" style={{ marginBottom: 12 }}>
        Equipment this work order touches:{' '}
        {check.touched.length ? check.touched.map((t) => <Lozenge key={t} tone="info">{t}</Lozenge>) : <em>none detected</em>}
        {' '}<a onClick={() => { setTagText(check.touched.join(', ')); setEditingTags(true); }}>Edit</a>
      </div>
      {editingTags && (
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="RTU-1, HWB-2" />
          <Button variant="primary" onClick={saveTags}>Save</Button>
          <Button variant="subtle" onClick={() => setEditingTags(false)}>Cancel</Button>
        </div>
      )}

      {check.conflicts.map((c) => <ConflictCard key={c.decisionId} issueKey={issueKey} conflict={c} onChanged={setCheck} />)}

      {check.acknowledged.map((a) => (
        <div key={a.decisionId} className="card" style={{ marginBottom: 12 }}>
          <Lozenge tone="success">Reaffirmed</Lozenge>
          <p style={{ margin: '8px 0 4px' }}>"{a.statement}"</p>
          <div className="subtlest">Reason: {a.resolution.reason}</div>
        </div>
      ))}

      {check.status === 'clear' && !check.acknowledged.length && (
        <div className="subtle">No standing decision governs {check.touched.length ? 'this equipment for this kind of work' : 'anything this work order mentions'}.</div>
      )}
    </div>
  );
}
