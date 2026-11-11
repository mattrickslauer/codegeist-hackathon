import { useState } from 'react';

/** Small shared UI pieces styled with Atlassian Design System tokens (see styles.css). */

export function Button({ variant = 'default', className = '', ...props }) {
  const cls = { primary: 'btn btn-primary', subtle: 'btn btn-subtle', danger: 'btn btn-danger' }[variant] ?? 'btn';
  return <button type="button" className={`${cls} ${className}`} {...props} />;
}

export function Lozenge({ tone = 'default', children }) {
  const cls = { success: 'lozenge-success', danger: 'lozenge-danger', info: 'lozenge-info', 'bold-danger': 'lozenge-bold-danger' }[tone] ?? '';
  return <span className={`lozenge ${cls}`}>{children}</span>;
}

/** Jira status lozenge coloured by status category (To Do / In Progress / Done). */
export function StatusLozenge({ name, category }) {
  const tone = { indeterminate: 'info', done: 'success' }[category] ?? 'default';
  return <Lozenge tone={tone}>{name}</Lozenge>;
}

export function Spinner({ label }) {
  return (
    <span className="row subtle">
      <span className="spinner" aria-hidden="true" /> {label}
    </span>
  );
}

export function Banner({ tone = 'info', children }) {
  return <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : undefined}>{children}</div>;
}

/** Jira space avatar with an initials fallback (in case the image is blocked or missing). */
export function SpaceChip({ space, onClick }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (!space) return <span className="subtle">No Jira space linked</span>;
  const avatar = space.avatarUrl && !imgFailed
    ? <img className="avatar" src={space.avatarUrl} alt="" onError={() => setImgFailed(true)} />
    : <span className="avatar">{space.key.slice(0, 2)}</span>;
  const label = <>{avatar}<span>{space.name || space.key}</span><span className="subtlest">{space.key}</span></>;
  return onClick
    ? <a className="space-chip" onClick={onClick} title="Open this space in Jira">{label}</a>
    : <span className="space-chip">{label}</span>;
}

export function Dialog({ title, children, footer, onClose }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="dialog-footer">{footer}</div>
      </div>
    </div>
  );
}

export const formatBytes = (bytes) => (bytes == null ? '' : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
