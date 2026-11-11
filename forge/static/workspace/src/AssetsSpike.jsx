import { useState } from 'react';
import { invoke } from '@forge/bridge';

const panel = { marginTop: 24, padding: 16, border: '1px solid var(--ds-border, #ccc)', borderRadius: 8 };
const logBox = { whiteSpace: 'pre-wrap', background: 'var(--ds-background-neutral, #f4f5f7)', padding: 12, borderRadius: 6, minHeight: 48, maxHeight: 360, overflow: 'auto' };

/**
 * Spike 4: can the app (asApp) read and write Jira Assets?
 * Probe → ensure the Precedent schema/types/attributes → import the EXB building one item per call.
 */
export default function AssetsSpike() {
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const say = (line) => setLog((prev) => [...prev, line]);

  async function probe() {
    setBusy(true);
    setLog([]);
    try {
      const res = await invoke('assetsProbe');
      if (!res.available) return say('✘ Assets is not available to the app on this site.');
      say(`✔ App can read Assets · workspace ${res.workspaceId}`);
      say(`  ${res.schemas.length} schemas: ${res.schemas.map((s) => `${s.key} (${s.objectCount})`).join(', ')}`);
    } catch (err) {
      say(`✘ Probe: ${String(err?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setLog([]);
    const t0 = performance.now();
    try {
      const model = await invoke('assetsSetup');
      const c = model.created;
      say(`✔ Schema ${model.schemaKey} (id ${model.schemaId}) ${c.schema ? 'created' : 'exists'} · types created: ${c.types.join(', ') || 'none'} · attributes created: ${c.attributes}`);
      const plan = await invoke('assetsImportPlan');
      say(`Importing "${plan.building}": ${plan.steps.length} items…`);
      let created = 0;
      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        setProgress({ done: i, total: plan.steps.length, current: `${step.kind} ${step.ref}` });
        const res = await invoke('assetsImportStep', step);
        if (res.created) created += 1;
        say(`  ${res.created ? '+ created' : '= exists '} ${step.kind.padEnd(9)} ${res.name} → ${res.objectKey}`);
      }
      setProgress({ done: plan.steps.length, total: plan.steps.length });
      say(`✔ Spike 4 PASSED: ${plan.steps.length} items in Assets (${created} new) in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
      say('  In Jira: Assets → object schemas → "Precedent" (key PREC).');
    } catch (err) {
      say(`✘ ${String(err?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Spike 4 · Jira Assets (as the app)</h2>
      <p>Creates a <strong>Precedent</strong> Assets schema (Site → Level → Equipment) and imports the EXB building's 28 pieces of equipment from COBie. Safe to run twice.</p>
      <button type="button" onClick={probe} disabled={busy}>Probe Assets</button>{' '}
      <button type="button" onClick={runImport} disabled={busy}>Import EXB into Assets</button>
      {busy && progress && <span> {progress.done}/{progress.total} · {progress.current}</span>}
      <pre style={logBox}>{log.join('\n') || 'No run yet.'}</pre>
    </section>
  );
}
