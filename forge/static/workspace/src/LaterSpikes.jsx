/**
 * Diagnostics panels for spikes 5, 6, 8, 9 and 10 (docs/ARCHITECTURE.md §7).
 * Spikes 8–9 also have a "real" surface (the JSM portal panel, Rovo chat); these panels run the same
 * backend paths from Jira so each spike can be checked on any site, including a clean one (spike 10).
 */
import { useState } from 'react';
import { invoke, view } from '@forge/bridge';
import PhotoRoundTrip from './PhotoRoundTrip.jsx';
import { listSpaces } from './api.js';

const panel = { marginTop: 24, padding: 16, border: '1px solid var(--ds-border, #ccc)', borderRadius: 8 };
const logBox = { whiteSpace: 'pre-wrap', background: 'var(--ds-background-neutral, #f4f5f7)', padding: 12, borderRadius: 6, minHeight: 48, fontSize: 13 };
const title = { marginTop: 0, fontSize: 18 };

export function Spike5() {
  return (
    <section style={panel}>
      <h2 style={title}>Spike 5 · Forge LLM in an install-link app</h2>
      <p className="subtle">Not started. Needed for plain-language conflict explanations (§6.4); the agent covers phrasing for now.</p>
    </section>
  );
}

export function Spike6() {
  return (
    <section style={panel}>
      <h2 style={title}>Spike 6 · Rovo agent + action</h2>
      <p className="subtle">Folded into spike 9 (agent, action and MCP tool), below.</p>
    </section>
  );
}

export function Spike8() {
  return (
    <section style={panel}>
      <h2 style={title}>Spike 8 · original photo upload (portal closeout)</h2>
      <p>Same upload path the JSM portal panel uses. The caller-identity check only runs in the portal: open a request in the
        customer portal (<span className="mono">/servicedesk/customer/portals</span>) to see the Precedent panel, ideally as an invited customer.</p>
      <PhotoRoundTrip />
    </section>
  );
}

export function Spike9() {
  const [tag, setTag] = useState('rtu 2');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setOut(JSON.stringify(await invoke('spikeEquipmentContext', { tag }), null, 2));
    } catch (err) {
      setOut(`✘ ${String(err?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panel}>
      <h2 style={title}>Spike 9 · Rovo agent, action and MCP tool</h2>
      <p>1. Run the action's logic directly (the tag is normalised, so "rtu 2" should find RTU-2):</p>
      <div className="row">
        <input className="input" value={tag} onChange={(e) => setTag(e.target.value)} style={{ maxWidth: 200 }} />
        <button type="button" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run get-equipment-context'}</button>
      </div>
      <pre style={{ ...logBox, marginTop: 12 }}>{out || 'No run yet.'}</pre>
      <p>2. In Rovo chat, pick the <strong>Precedent</strong> agent and ask "What is RTU-2?". Pass: it quotes 460-3-60, MOP 250 and sheet E3.06A.</p>
      <p>3. Optional: admin.atlassian.com → Connected apps → Precedent → "Expose tools via external MCP endpoint", then call the tool from an MCP client.</p>
    </section>
  );
}

export function Spike10() {
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const out = [];
    const say = (l) => { out.push(l); setLines([...out]); };
    try {
      const ctx = await view.getContext();
      say(`Site: ${ctx.siteUrl ?? '?'} · environment: ${ctx.environmentType ?? '?'}`);
      const res = await invoke('spikeCleanSite');
      say(`Backend v${res.backendVersion} · Precedent sites here: ${res.sites ?? '?'}`);
      say(res.assets?.available
        ? `✔ Assets available (workspace ${res.assets.workspaceId}; schemas: ${res.assets.schemas.map((s) => s.key).join(', ') || 'none'})`
        : '✘ Assets NOT available to the app on this site → the demo uses the bundled graph');
      for (const e of res.errors) say(`✘ ${e}`);
      const spaces = await listSpaces();
      const service = spaces.filter((s) => s.projectTypeKey === 'service_desk');
      say(`Jira spaces: ${spaces.length} (${service.length} service spaces${service.length ? `: ${service.map((s) => s.key).join(', ')}` : ''})`);
      if (!service.length) say('✘ No service space → the contractor portal flow needs one (setup must create it)');
      say('Rovo: check by hand that Rovo chat opens and lists the Precedent agent (spike 9 step 2).');
    } catch (err) {
      say(`✘ ${String(err?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panel}>
      <h2 style={title}>Spike 10 · clean (judge-like) site</h2>
      <p>Run this on a site that installed Precedent from the install link, with nothing set up.</p>
      <button type="button" onClick={run} disabled={busy}>{busy ? 'Checking…' : 'Run spike 10 checks'}</button>
      <pre style={{ ...logBox, marginTop: 12 }}>{lines.join('\n') || 'No run yet.'}</pre>
    </section>
  );
}
