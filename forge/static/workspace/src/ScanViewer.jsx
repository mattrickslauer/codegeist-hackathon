import ModelViewer from './ModelViewer.jsx';

/**
 * Back-compat wrapper used by Diagnostics: a raw scan Blob in ModelViewer.
 * Maps ModelViewer's report shape to the fields the spike-2 panel logs.
 */
export default function ScanViewer({ blob, onReport, onPick, onError }) {
  return (
    <ModelViewer
      source={{ blob }}
      height={480}
      onPick={onPick}
      onError={onError}
      onReport={(r) => onReport?.({ parseMs: r.ms, triangles: r.triangles, extent: r.extent, textures: [], webgl: 'WebGL2' })}
    />
  );
}
