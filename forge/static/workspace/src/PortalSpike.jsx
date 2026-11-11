import { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import PhotoRoundTrip from './PhotoRoundTrip.jsx';

const box = { whiteSpace: 'pre-wrap', background: 'var(--ds-background-neutral, #f4f5f7)', padding: 12, borderRadius: 6, fontSize: 13 };

/**
 * Spike 8 (jiraServiceManagement:portalRequestDetail): does the panel run for a portal customer,
 * who does the backend think is calling, and can an original photo round-trip byte-identical?
 */
export default function PortalSpike({ context }) {
  const [who, setWho] = useState(null);

  useEffect(() => {
    invoke('portalWhoAmI').then(setWho).catch((err) => setWho({ error: String(err?.message ?? err) }));
  }, []);

  return (
    <div style={{ padding: 8 }}>
      <strong>Precedent · spike 8 (portal panel)</strong>
      <div style={{ ...box, marginTop: 8 }}>
        {`extension: ${context?.extension?.type}\nrequest: ${context?.extension?.request?.key}\n`}
        {who ? JSON.stringify(who, null, 2) : 'Asking the backend who I am…'}
      </div>
      <div style={{ marginTop: 12 }}><PhotoRoundTrip /></div>
    </div>
  );
}
