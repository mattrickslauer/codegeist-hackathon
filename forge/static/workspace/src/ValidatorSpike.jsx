import { useState } from 'react';
import { requestJira } from '@forge/bridge';

/** Issue property the workflow validator reads (manifest: precedent-open-conflict-validator). */
export const CHECK_PROPERTY = 'precedent.check';

const TEST_CONFLICT = {
  status: 'conflict',
  summary: 'Bypass valve V-12 stays locked open until pump P-3 is commissioned',
  decidedBy: 'Site lead (spike test data)',
  decidedAt: '2026-03-03',
  source: 'spike-3',
};

const panel = { marginTop: 24, padding: 16, border: '1px solid var(--ds-border, #ccc)', borderRadius: 8 };
const logBox = { whiteSpace: 'pre-wrap', background: 'var(--ds-background-neutral, #f4f5f7)', padding: 12, borderRadius: 6, minHeight: 48 };

/**
 * Spike 3: set / clear / read the `precedent.check` issue property so we can prove the
 * workflow validator blocks "Start" (To Do → In Progress) while a conflict is open.
 * Calls Jira REST as the current user (requestJira).
 */
export default function ValidatorSpike() {
  const [issueKey, setIssueKey] = useState('FAC-272');
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const say = (line) => setLog((prev) => [...prev, line]);

  const propertyPath = () => `/rest/api/3/issue/${encodeURIComponent(issueKey.trim())}/properties/${CHECK_PROPERTY}`;

  async function run(label, fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      say(`✘ ${label}: ${String(err?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  const read = () => run('Read', async () => {
    const res = await requestJira(propertyPath());
    if (res.status === 404) return say(`• ${issueKey}: no ${CHECK_PROPERTY} property (validator allows transitions)`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    say(`• ${issueKey}: ${CHECK_PROPERTY} = ${JSON.stringify(body.value)}`);
  });

  const markConflict = () => run('Mark conflict', async () => {
    const res = await requestJira(propertyPath(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_CONFLICT),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    say(`✔ ${issueKey}: marked CONFLICT. Now try "Start" on the work order; it should be blocked.`);
  });

  const clear = () => run('Clear', async () => {
    const res = await requestJira(propertyPath(), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    say(`✔ ${issueKey}: property cleared. "Start" should now be allowed.`);
  });

  return (
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Spike 3 · workflow validator</h2>
      <p>Sets a test conflict on a work order. With the validator on the "Start" transition, Jira should refuse To Do → In Progress until it's cleared.</p>
      <label>
        Work order key{' '}
        <input value={issueKey} onChange={(e) => setIssueKey(e.target.value)} disabled={busy} style={{ width: 120 }} />
      </label>{' '}
      <button type="button" onClick={markConflict} disabled={busy}>Mark conflict (test)</button>{' '}
      <button type="button" onClick={clear} disabled={busy}>Clear</button>{' '}
      <button type="button" onClick={read} disabled={busy}>Read</button>
      <pre style={logBox}>{log.join('\n') || 'No run yet.'}</pre>
    </section>
  );
}
