import { useEffect, useState } from 'react';
import { view } from '@forge/bridge';

/**
 * Minimal router on top of Jira's browser history (view.createHistory), so each page in the
 * workspace has its own URL and the back button works. Falls back to in-memory navigation
 * if history isn't available (e.g. local preview).
 *
 * Routes: '/'  ·  '/sites/:id'  ·  '/diagnostics'
 */
let historyPromise = null;
const getHistory = () => {
  if (!historyPromise) historyPromise = view.createHistory().catch(() => null);
  return historyPromise;
};

// Local preview starts at #/sites/<id> when given; Jira always has history.
let memoryPath = typeof location !== 'undefined' && location.hash.startsWith('#/') ? location.hash.slice(1) : '/';
const memoryListeners = new Set();

export async function navigate(path) {
  const history = await getHistory();
  if (history) history.push(path);
  else {
    memoryPath = path;
    memoryListeners.forEach((fn) => fn(path));
  }
}

export function parseRoute(path) {
  const [pathname, search = ''] = path.split('?');
  const query = new URLSearchParams(search);
  const site = pathname.match(/^\/sites\/([^/]+)/);
  if (site) return { name: 'site', id: decodeURIComponent(site[1]), equipment: query.get('equipment') };
  if (path.startsWith('/diagnostics')) return { name: 'diagnostics' };
  return { name: 'sites' };
}

export function useRoute() {
  const [path, setPath] = useState(null);
  useEffect(() => {
    let unlisten = () => {};
    getHistory().then((history) => {
      if (history) {
        setPath(`${history.location.pathname || '/'}${history.location.search || ''}`);
        unlisten = history.listen((update) => {
          // history v5 passes { location }, v4 passes location.
          const location = update?.location ?? update;
          setPath(`${location.pathname || '/'}${location.search || ''}`);
        });
      } else {
        setPath(memoryPath);
        memoryListeners.add(setPath);
        unlisten = () => memoryListeners.delete(setPath);
      }
    });
    return () => unlisten();
  }, []);
  return path === null ? null : parseRoute(path);
}
