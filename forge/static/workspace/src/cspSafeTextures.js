import { Texture } from 'three';

/**
 * GLTFLoader plugin: decode textures embedded in a GLB without blob: URLs.
 *
 * Why: three.js GLTFLoader turns each embedded image into a `blob:` object URL and loads it with
 * ImageBitmapLoader, which *fetches* that URL. Forge Custom UI's Content Security Policy does not
 * allow `blob:` in `connect-src`, so the fetch is blocked and the scan renders untextured
 * (spike 2, 2026-11-08: "CSP blocked blob · directive connect-src").
 *
 * Fix: for images stored in a bufferView, decode the bytes directly with createImageBitmap(Blob),
 * which involves no URL and therefore no CSP check. We use the same decode options three.js passes
 * to ImageBitmapLoader. Sampler, flipY and colour-space handling stay in GLTFLoader's
 * loadTextureImage, which wraps this.
 *
 * Usage: new GLTFLoader().register((parser) => cspSafeEmbeddedTextures(parser))
 */
export function cspSafeEmbeddedTextures(parser) {
  const original = parser.loadImageSource.bind(parser);

  parser.loadImageSource = function loadImageSourceWithoutBlobUrl(sourceIndex, loader) {
    const sourceDef = parser.json.images[sourceIndex];
    // Only embedded images take the blob-URL path; external URIs and data: URIs keep the original behaviour.
    if (sourceDef.bufferView === undefined || typeof createImageBitmap === 'undefined') {
      return original(sourceIndex, loader);
    }
    if (parser.sourceCache[sourceIndex] !== undefined) {
      return parser.sourceCache[sourceIndex].then((texture) => texture.clone());
    }

    const promise = parser.getDependency('bufferView', sourceDef.bufferView).then(async (bufferView) => {
      const blob = new Blob([bufferView], { type: sourceDef.mimeType });
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const texture = new Texture(bitmap);
      texture.needsUpdate = true;
      texture.userData.mimeType = sourceDef.mimeType;
      return texture;
    });

    parser.sourceCache[sourceIndex] = promise;
    return promise;
  };

  return { name: 'PRECEDENT_csp_safe_embedded_textures' };
}
