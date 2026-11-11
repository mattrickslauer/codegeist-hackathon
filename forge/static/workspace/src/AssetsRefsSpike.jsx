import { useState } from 'react';
import { invoke } from '@forge/bridge';

const panel = { marginTop: 24, padding: 16, border: '1px solid var(--ds-border, #ccc)', borderRadius: 8 };
const logBox = { whiteSpace: 'pre-wrap', background: 'var(--ds-background-neutral, #f4f5f7)', padding: 12, borderRadius: 6, minHeight: 48 };

/** Spike 7: Assets reference attributes (graph links) and whether the app account can write objects. */
export default function AssetsRefsSpike() {
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    setSteps([]);
    try {
      const res = await invoke('spikeAssetsRefs');
      setSteps(res.steps);
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Spike 7 · Assets references (graph links)</h2>
      <button type="button" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run spike 7'}</button>
      <div style={{ ...logBox, marginTop: 12 }}>
        {error && `✘ ${error}\n`}
        {steps.map((s) => `${s.ok ? '✔' : '✘'} ${s.name}: ${s.detail}`).join('\n')}
      </div>
    </section>
  );
}
