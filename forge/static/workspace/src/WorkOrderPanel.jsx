import { useEffect, useState } from 'react';
import { router } from '@forge/bridge';
import { api } from './api.js';
import { Banner, Button, Lozenge, Spinner, formatDate } from './ui.jsx';
import { normaliseCheck } from './siteState.js';
import './panel.css';

/** Accept a check result from the backend: keep 'unlinked' as-is, normalise everything else. */
const acceptCheck = (r) => (r?.status === 'unlinked' ? r : normaliseCheck(r));

const openOnModel = (siteId, tag) => router.navigate({
  target: 'module',
  moduleKey: 'walkdown-workspace',
  path: `/sites/${encodeURIComponent(siteId)}${tag ? `?equipment=${encodeURIComponent(tag)}` : ''}`,
});

const CHOICES = [
  ['reaffirm', 'Reaffirm', 'The work fits the decision after all (for example, it’s scheduled outside the protected hours). Say why; the work order is released.'],
  ['supersede', 'Supersede', 'The decision itself should change. Propose the new one; a site approver must accept it before the work order is released.'],
  ['withdraw', 'Withdraw', 'Change this work order so it no longer conflicts. Walkdown re-checks it when you save.'],
];

/**
 * One conflict on the work order: the decision, why it exists, what matched, and the three ways to resolve it.
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
        setDone('Proposed. This work order stays blocked until a site approver accepts the new decision (Walkdown → the site → Decisions).');
        setMode(null);
      }
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wp-conflict">
      <div className="wp-decision">
        <div className="wp-kicker">Standing decision · {formatDate(conflict.decidedAt)}</div>
        <blockquote>{conflict.statement}</blockquote>
        {conflict.reason && <div className="wp-why"><strong>Why:</strong> {conflict.reason}</div>}
      </div>
      <div className="wp-match">
        <span>This work order</span>
        {conflict.guardsMatched.length > 0
          ? <>wants to <mark>{conflict.guardsMatched.join(', ')}</mark></>
          : <>touches</>}
        {conflict.matched.map((t) => <button key={t} type="button" className="wp-tag" onClick={() => openOnModel(conflict.siteId, t)} title="Show it on the building">{t}</button>)}
        {conflict.guardsMatched.length === 0 && <span className="subtle">(any work on it needs review)</span>}
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {done && <Banner tone="info">{done}</Banner>}

      {!done && (
        <>
          <div className="wp-choose">To start this work, choose one:</div>
          <div className="wp-choices">
            {CHOICES.map(([key, title, text]) => (
              <button key={key} type="button" className={`wp-choice ${mode === key ? 'wp-choice-on' : ''}`} aria-pressed={mode === key} onClick={() => setMode(mode === key ? null : key)}>
                <strong>{title}</strong>
                <span>{text}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'reaffirm' && (
        <div className="wp-form">
          <div className="field">
            <label htmlFor={`r-${conflict.decisionId}`}>Why is this work order consistent with the decision?</label>
            <textarea id={`r-${conflict.decisionId}`} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scheduled for Saturday 06:00, outside the protected hours" />
          </div>
          <div className="row"><Button variant="primary" onClick={submit} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Reaffirm and release'}</Button><Button variant="subtle" onClick={() => setMode(null)}>Cancel</Button></div>
        </div>
      )}
      {mode === 'supersede' && (
        <div className="wp-form">
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
          Edit this work order so it no longer conflicts (change the action, the timing or the equipment). Walkdown re-checks it automatically when you save.
        </Banner>
      )}
    </div>
  );
}

/**
 * The Walkdown panel on a Jira work order (jira:issuePanel).
 * Runs the check, shows detected equipment and any conflicting standing decisions, and lets the user
 * reaffirm (with a reason), propose a superseding decision (needs an approver), or withdraw (edit the work order).
 */
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
  if (!check) return <div style={{ padding: 8 }}><Spinner label="Checking against the site's decisions…" /></div>;

  if (check.status === 'unlinked') {
    return (
      <div className="wp-verdict wp-verdict-none">
        <div className="wp-verdict-title">Not linked to a Walkdown site</div>
        <div>No site guards this space ({check.projectKey}). Link one in <a onClick={() => router.navigate('/jira/apps')}>Walkdown</a> → the site → Settings.</div>
      </div>
    );
  }

  const blocked = check.status === 'conflict';
  const n = check.conflicts.length;
  return (
    <div className="wp">
      <div className={`wp-verdict ${blocked ? 'wp-verdict-blocked' : 'wp-verdict-clear'}`}>
        <div className="wp-verdict-icon" aria-hidden="true">{blocked ? '!' : '✓'}</div>
        <div style={{ flex: 1 }}>
          <div className="wp-verdict-title">{blocked ? `Can’t start yet: conflicts with ${n === 1 ? 'a standing decision' : `${n} standing decisions`}` : 'Clear to start'}</div>
          <div className="wp-verdict-sub">
            {blocked
              ? 'Resolve it below before the work starts.'
              : check.acknowledged.length
                ? 'Reaffirmed against the decisions below.'
                : check.touched.length ? 'No standing decision governs this equipment for this kind of work.' : 'It doesn’t name any equipment Walkdown knows.'}
          </div>
        </div>
        <span className="wp-checked">Checked {new Date(check.checkedAt).toLocaleTimeString()} · <a onClick={load}>Re-check</a></span>
      </div>

      <div className="wp-equipment">
        <span className="subtle">Equipment</span>
        {check.touched.length
          ? check.touched.map((t) => <button key={t} type="button" className="wp-tag" onClick={() => openOnModel(check.siteId, t)} title="Show it on the building">{t}</button>)
          : <em className="subtle">none detected</em>}
        {check.siteId && check.touched.length > 0 && <a onClick={() => openOnModel(check.siteId, check.touched[0])}>View on the building</a>}
        <a onClick={() => { setTagText(check.touched.join(', ')); setEditingTags(true); }}>Edit</a>
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
        <div key={a.decisionId} className="wp-ack">
          <Lozenge tone="success">Reaffirmed</Lozenge>
          <p style={{ margin: '8px 0 4px' }}>"{a.statement}"</p>
          <div className="subtlest">Reason: {a.resolution.reason}</div>
        </div>
      ))}
    </div>
  );
}
