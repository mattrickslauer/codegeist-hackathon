import { useEffect, useState } from 'react';
import { invoke, objectStore } from '@forge/bridge';
import { sha256Hex } from './hash.js';

const box = { whiteSpace: 'pre-wrap', background: 'var(--ds-background-neutral, #f4f5f7)', padding: 12, borderRadius: 6, fontSize: 13 };
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Spike 8 (jiraServiceManagement:portalRequestDetail): does the panel run for a portal customer,
 * who does the backend think is calling, and can an original photo round-trip byte-identical?
 */
export default function PortalSpike({ context }) {
  const [who, setWho] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const say = (line) => setLog((prev) => [...prev, line]);

  useEffect(() => {
    invoke('portalWhoAmI').then(setWho).catch((err) => setWho({ error: String(err?.message ?? err) }));
  }, []);

  async function roundTrip(file) {
    setBusy(true);
    setLog([]);
    try {
      say(`Selected ${file.name} · ${mb(file.size)} · type "${file.type || 'unknown'}"`);
      const local = await sha256Hex(file);
      let t0 = performance.now();
      const [up] = await objectStore.upload({ functionKey: 'getPhotoUploadUrls', objects: [file] });
      if (!up?.success) throw new Error(`upload failed (${up?.status ?? 'no status'}) ${up?.error ?? ''}`);
      say(`✔ Uploaded in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${up.key}`);
      t0 = performance.now();
      const [down] = await objectStore.download({ functionKey: 'getPhotoDownloadUrls', keys: [up.key] });
      if (!down?.success || !down.blob) throw new Error(`download failed (${down?.status ?? 'no status'}) ${down?.error ?? ''}`);
      const remote = await sha256Hex(down.blob);
      say(`✔ Downloaded in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${mb(down.blob.size)}`);
      say(local === remote ? `✔ SPIKE 8 PASSED: byte-identical (SHA-256 ${local.slice(0, 16)}…)` : `✘ Hash mismatch ${local.slice(0, 16)} vs ${remote.slice(0, 16)}`);
    } catch (err) {
      say(`✘ ${String(err?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 8 }}>
      <strong>Precedent · spike 8 (portal panel)</strong>
      <div style={{ ...box, marginTop: 8 }}>
        {`extension: ${context?.extension?.type}\nrequest: ${context?.extension?.request?.key}\n`}
        {who ? JSON.stringify(who, null, 2) : 'Asking the backend who I am…'}
      </div>
      <div style={{ marginTop: 12 }}>
        <label>
          Original photo (JPEG, HEIC, PNG, DNG…):{' '}
          <input type="file" disabled={busy} onChange={(e) => e.target.files?.[0] && roundTrip(e.target.files[0])} />
        </label>
      </div>
      {log.length > 0 && <div style={{ ...box, marginTop: 12 }}>{log.join('\n')}</div>}
    </div>
  );
}
