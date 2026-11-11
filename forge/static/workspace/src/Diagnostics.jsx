import { useEffect, useState } from 'react';
import { invoke, objectStore } from '@forge/bridge';
import ScanViewer from './ScanViewer.jsx';
import ValidatorSpike from './ValidatorSpike.jsx';
import AssetsSpike from './AssetsSpike.jsx';
import AssetsRefsSpike from './AssetsRefsSpike.jsx';
import { navigate } from './router.js';

/** The 17 MB Scaniverse sample uploaded during spike 1 (content-addressed key). */
const SAMPLE_SCAN_KEY = 'scans/sha256-zt-WlSvcMpaRAwzOn2qnh8yVxCRAyeiRdgGr2Va9b1w';

/** SHA-256 of a Blob as lowercase hex (used to prove the round trip is byte-identical). */
async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const panel = { marginTop: 24, padding: 16, border: '1px solid var(--ds-border, #ccc)', borderRadius: 8 };
const logBox = { whiteSpace: 'pre-wrap', background: 'var(--ds-background-neutral, #f4f5f7)', padding: 12, borderRadius: 6, minHeight: 48 };

/** Workspace shell + spikes 1 (Object Store round trip) and 2 (3D viewer). */
/** Developer diagnostics: the spike test panels (not part of the product UI). */
export default function Diagnostics() {
  const [ping, setPing] = useState({ state: 'loading' });
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState(SAMPLE_SCAN_KEY);

  const [viewerBlob, setViewerBlob] = useState(null);
  const [viewerLog, setViewerLog] = useState([]);
  const [viewerBusy, setViewerBusy] = useState(false);

  const say = (line) => setLog((prev) => [...prev, line]);
  const vsay = (line) => setViewerLog((prev) => [...prev, line]);

  useEffect(() => {
    invoke('ping')
      .then((res) => setPing({ state: 'ok', res }))
      .catch((err) => setPing({ state: 'error', message: String(err?.message ?? err) }));
  }, []);

  // Surface Content Security Policy violations in the page (spike 2 diagnostics).
  useEffect(() => {
    const onViolation = (e) => vsay(`✘ CSP blocked ${e.blockedURI || '(inline)'} · directive ${e.violatedDirective}`);
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => document.removeEventListener('securitypolicyviolation', onViolation);
  }, []);

  async function runRoundTrip(file) {
    setBusy(true);
    setLog([]);
    try {
      say(`Selected ${file.name} · ${mb(file.size)} · type "${file.type || 'unknown'}"`);
      const localHash = await sha256Hex(file);
      say(`Local SHA-256 ${localHash.slice(0, 16)}…`);

      let t0 = performance.now();
      const [up] = await objectStore.upload({ functionKey: 'getScanUploadUrls', objects: [file] });
      const uploadMs = performance.now() - t0;
      if (!up?.success) throw new Error(`Upload failed: status ${up?.status ?? '?'} ${up?.error ?? ''}`);
      say(`✔ Uploaded in ${secs(uploadMs)} (${mb(file.size / (uploadMs / 1000))}/s) → key ${up.key}`);
      setLastKey(up.key);

      t0 = performance.now();
      const [down] = await objectStore.download({ functionKey: 'getScanDownloadUrls', keys: [up.key] });
      const downloadMs = performance.now() - t0;
      if (!down?.success || !down.blob) throw new Error(`Download failed: status ${down?.status ?? '?'} ${down?.error ?? ''}`);
      say(`✔ Downloaded ${mb(down.blob.size)} in ${secs(downloadMs)}`);

      const remoteHash = await sha256Hex(down.blob);
      if (remoteHash !== localHash) throw new Error(`Checksum mismatch: local ${localHash} vs downloaded ${remoteHash}`);
      say('✔ Round trip verified: downloaded bytes are identical (SHA-256 match). Spike 1 PASSED.');
    } catch (err) {
      say(`✘ ${String(err?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function viewScan(key) {
    setViewerBusy(true);
    setViewerLog([]);
    setViewerBlob(null);
    try {
      const t0 = performance.now();
      const [down] = await objectStore.download({ functionKey: 'getScanDownloadUrls', keys: [key] });
      if (!down?.success || !down.blob) throw new Error(`Download failed: status ${down?.status ?? '?'} ${down?.error ?? ''}`);
      vsay(`✔ Downloaded ${mb(down.blob.size)} in ${secs(performance.now() - t0)} · key ${key.slice(0, 32)}…`);
      setViewerBlob(down.blob);
    } catch (err) {
      vsay(`✘ ${String(err?.message ?? err)}`);
    } finally {
      setViewerBusy(false);
    }
  }

  const onReport = (r) => {
    if (r.parseMs !== undefined) {
      vsay(`✔ Parsed in ${r.parseMs} ms · ${r.triangles.toLocaleString()} triangles · extent ${r.extent.join(' × ')} m · textures ${r.textures.join(', ') || 'none'} · ${r.webgl}`);
    }
    if (r.fps !== undefined) {
      vsay(`✔ ${r.fps} FPS (3 s sample). Drag to orbit, scroll to zoom, click the mesh to pick a point.`);
    }
  };

  return (
    <main className="page">
      <div className="breadcrumbs"><a onClick={() => navigate('/')}>Sites</a> / Diagnostics</div>
      <h1 className="page-title">Diagnostics</h1>
      <p className="subtle">Developer test panels from the spikes. Not part of the product.</p>
      {ping.state === 'loading' && <p>Connecting to backend…</p>}
      {ping.state === 'error' && <p role="alert">Backend error: {ping.message}</p>}
      {ping.state === 'ok' && <p>Backend v{ping.res.backendVersion} reachable · server time {ping.res.serverTime}</p>}

      <AssetsSpike />
      <AssetsRefsSpike />

      <ValidatorSpike />

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Spike 2 · 3D scan viewer</h2>
        <p>Loads a stored scan from Object Store and renders it with three.js inside this Jira page.</p>
        <button type="button" disabled={viewerBusy} onClick={() => viewScan(lastKey)}>
          {lastKey === SAMPLE_SCAN_KEY ? 'View stored sample scan' : 'View last uploaded scan'}
        </button>
        {viewerBusy && <span> Loading…</span>}
        {viewerBlob && (
          <div style={{ marginTop: 12 }}>
            <ScanViewer
              blob={viewerBlob}
              onReport={onReport}
              onPick={({ point, normal }) => vsay(`• Picked point [${point.join(', ')}] m · normal [${normal?.join(', ') ?? 'n/a'}]`)}
              onError={(err) => vsay(`✘ Viewer error: ${String(err?.message ?? err)}`)}
            />
          </div>
        )}
        <pre style={logBox}>{viewerLog.join('\n') || 'No run yet.'}</pre>
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Spike 1 · scan upload round trip</h2>
        <p>Pick a GLB scan. It uploads straight to Forge Object Store, downloads back, and the bytes are compared.</p>
        <input
          type="file"
          accept=".glb,model/gltf-binary"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && runRoundTrip(e.target.files[0])}
        />
        {busy && <p>Working…</p>}
        <pre style={logBox}>{log.join('\n') || 'No run yet.'}</pre>
      </section>
    </main>
  );
}
