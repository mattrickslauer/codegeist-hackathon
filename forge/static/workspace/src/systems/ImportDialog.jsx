import { useMemo, useState } from 'react';
import { importOps } from '../../../../src/graphImport.js';

const EXAMPLE_CONNECTIONS = `From\tTo\tSystem\tSize\tMaterial
CHWP-1\tV-101\tChilled water\t4\tSteel
V-101\tAHU-1\tChilled water\t4\tSteel
MSB\tPNL-H1\tElectrical
PNL-H1\tAHU-1\tElectrical`;

const EXAMPLE_COMPONENTS = `Tag\tType\tSize (in)\tPosition\tLocation
V-101\tValve\t4\topen\tMech room 2
V-102\tValve\t4\tclosed\tMech room 2
CHWP-1\tPump\t\t\tMech room 2`;

/** Paste rows from a spreadsheet (valve schedule, panel schedule, riser list) and preview before adding. */
export default function ImportDialog({ graph, onImport, onClose }) {
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? importOps(graph, text) : null), [graph, text]);
  const ready = result && result.ops.length > 0;
  return (
    <div className="sx-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sx-modal" role="dialog" aria-label="Paste from a spreadsheet">
        <div className="sx-pop-head"><strong>Paste from a spreadsheet</strong><button type="button" className="sx-x" onClick={onClose}>×</button></div>
        <p className="sx-muted" style={{ margin: '0 0 10px' }}>
          Copy rows from Excel or Google Sheets, header row included. <strong>From / To</strong> columns add connections (missing components are created, their type guessed from the tag: V-12 is a valve, CHWP-1 a pump, PNL-H1 a panel). A <strong>Tag</strong> column adds or updates components, and every other column becomes a value.
        </p>
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setText(EXAMPLE_CONNECTIONS)}>Example: connections</button>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setText(EXAMPLE_COMPONENTS)}>Example: valve schedule</button>
        </div>
        <textarea className="sx-paste" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'From\tTo\tSystem\tSize\nCHWP-1\tV-101\tChilled water\t4'} spellCheck={false} />
        {result && (
          <div className="sx-import-preview">
            <div className="row" style={{ gap: 16 }}>
              <span><strong>{result.summary.components}</strong> new components</span>
              <span><strong>{result.summary.connections}</strong> connections</span>
              <span><strong>{result.summary.updated}</strong> updated</span>
            </div>
            {result.warnings.slice(0, 6).map((w) => <div key={w} className="sx-warn">{w}</div>)}
            {result.warnings.length > 6 && <div className="sx-muted">…and {result.warnings.length - 6} more notes</div>}
          </div>
        )}
        <div className="sx-pop-foot">
          <span className="sx-muted">Imported values are labelled <em>Entered</em>, with your name and the date. Undo removes the whole import.</span>
          <button type="button" className="sx-btn sx-btn-primary" disabled={!ready} onClick={() => onImport(result.ops, `Imported ${result.summary.components} components, ${result.summary.connections} connections`)}>Add to the building</button>
        </div>
      </div>
    </div>
  );
}
