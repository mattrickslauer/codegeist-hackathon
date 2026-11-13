import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { applyOps } from '../../../../src/graphEdit.js';

/**
 * The site graph for the editor, with optimistic edits.
 * Edits apply locally at once (same pure engine as the backend), then go to the server one at a time in order.
 * If the server refuses one, local state rolls back to the server's graph and the error is shown.
 */
export function useSiteGraph(siteId) {
  const [server, setServer] = useState(undefined); // undefined = loading, null = no graph yet
  const [local, setLocal] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [canStartFromRegister, setCanStart] = useState(false);
  const queue = useRef(Promise.resolve());
  const serverRef = useRef(null);
  const pending = useRef(0);

  const adopt = useCallback((g) => {
    serverRef.current = g;
    setServer(g);
    if (pending.current === 0) setLocal(g);
  }, []);

  const reload = useCallback(() => {
    setError(null);
    return api.getSiteGraph(siteId).then((r) => {
      setCanStart(Boolean(r.canStartFromRegister));
      pending.current = 0;
      adopt(r.graph);
      setLocal(r.graph);
    }).catch((e) => { setError(String(e?.message ?? e)); setServer(null); });
  }, [siteId, adopt]);
  useEffect(() => { reload(); }, [reload]);

  const start = useCallback(async () => {
    setSaving(true);
    try { const r = await api.startSiteGraph(siteId); adopt(r.graph); setLocal(r.graph); } catch (e) { setError(String(e?.message ?? e)); } finally { setSaving(false); }
  }, [siteId, adopt]);

  /** Apply ops. Returns the locally applied result (so callers can select a new id at once), or null on error. */
  const edit = useCallback((ops, label) => {
    let applied;
    try {
      applied = applyOps(localRef.current, ops, 'me');
    } catch (e) {
      setError(String(e?.message ?? e));
      return null;
    }
    setError(null);
    localRef.current = applied.graph;
    setLocal(applied.graph);
    pending.current += 1;
    setSaving(true);
    queue.current = queue.current.then(async () => {
      try {
        const r = await api.editSiteGraph(siteId, serverRef.current?.rev ?? 0, ops, label);
        pending.current -= 1;
        serverRef.current = r.graph;
        setServer(r.graph);
        if (pending.current === 0) { localRef.current = r.graph; setLocal(r.graph); }
      } catch (e) {
        pending.current = 0;
        setError(String(e?.message ?? e));
        localRef.current = serverRef.current;
        setLocal(serverRef.current);
      } finally {
        if (pending.current === 0) setSaving(false);
      }
    });
    return applied;
  }, [siteId]);

  const undo = useCallback(() => {
    queue.current = queue.current.then(async () => {
      setSaving(true);
      try {
        const r = await api.undoSiteGraph(siteId, serverRef.current?.rev ?? 0);
        serverRef.current = r.graph;
        setServer(r.graph);
        localRef.current = r.graph;
        setLocal(r.graph);
        setError(null);
      } catch (e) { setError(String(e?.message ?? e)); } finally { setSaving(false); }
    });
  }, [siteId]);

  const localRef = useRef(null);
  localRef.current = local;

  return { graph: local, loading: server === undefined, error, setError, saving, edit, undo, reload, start, canStartFromRegister };
}
