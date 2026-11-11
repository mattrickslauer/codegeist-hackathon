import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import { useRoute } from './router.js';
import SitesPage from './SitesPage.jsx';
import SitePage from './SitePage.jsx';
import WorkOrderPanel from './WorkOrderPanel.jsx';
import { Banner, Button, Spinner } from './ui.jsx';

// Developer test panels; loaded only when visited.
const Diagnostics = lazy(() => import('./Diagnostics.jsx'));
// JSM portal panel (spike 8); loaded only in the portal.
const PortalSpike = lazy(() => import('./PortalSpike.jsx'));

/** Workspace (global page): routes between Sites, a Site, and Diagnostics. */
function Workspace() {
  const route = useRoute();
  if (!route) return <div className="page"><Spinner label="Loading…" /></div>;
  return (
    <>
      {route.name === 'sites' && <SitesPage />}
      {route.name === 'site' && <SitePage id={route.id} equipment={route.equipment} />}
      {route.name === 'diagnostics' && (
        <Suspense fallback={<div className="page"><Spinner label="Loading diagnostics…" /></div>}>
          <Diagnostics />
        </Suspense>
      )}
      {/* Diagnostics (developer test panels) is reachable only at /diagnostics, not linked in the product. */}
      <div className="page footer subtlest" style={{ paddingTop: 0 }}>
        Precedent · every decision about a building, pinned to the equipment it governs, enforced on every work order
      </div>
    </>
  );
}

/**
 * Catches render errors so one bad value shows a message instead of a blank app.
 * (2026-11-11: a legacy issue property crashed the whole site page.)
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Precedent render error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <Banner tone="error">
          Something went wrong showing this page: <span className="mono">{String(this.state.error?.message ?? this.state.error)}</span>
        </Banner>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}

/** One bundle, two Jira surfaces: the work-order panel (jira:issuePanel) or the workspace (jira:globalPage). */
export default function App() {
  const [context, setContext] = useState(null);
  useEffect(() => { view.getContext().then(setContext).catch(() => setContext({})); }, []);
  if (!context) return <Spinner label="Loading…" />;
  return (
    <ErrorBoundary>
      {context.extension?.type === 'jira:issuePanel' && <WorkOrderPanel issueKey={context.extension.issue.key} />}
      {context.extension?.type === 'jiraServiceManagement:portalRequestDetail' && (
        <Suspense fallback={<Spinner label="Loading…" />}><PortalSpike context={context} /></Suspense>
      )}
      {!['jira:issuePanel', 'jiraServiceManagement:portalRequestDetail'].includes(context.extension?.type) && <Workspace />}
    </ErrorBoundary>
  );
}
