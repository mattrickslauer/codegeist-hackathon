# Sample scans

Real LiDAR scans captured on an iPhone 17 Pro with **Scaniverse** (mesh mode), exported as **GLB** (glTF 2.0 binary). They're used for the web-viewer and upload spikes, and as candidates for the sample site judges get on install.

| File | Size | Triangles | Vertices | Extent x × y × z (m, Y-up) | SHA-256 |
|---|---|---|---|---|---|
| `scaniverse-2026-11-07-1225.glb` | 17.0 MB | 187,275 | 128,842 | 7.02 × 4.85 × 7.06 | `cedf9695…bd6f5c` |
| `scaniverse-2026-11-07-1232.glb` | 19.1 MB | 179,958 | 111,516 | 8.69 × 4.26 × 7.38 | `21936364…6b5058` |

**Structure (both files):** one mesh, one primitive, one embedded JPEG texture, two nodes. There are no glTF extensions (no Draco/meshopt compression), so three.js `GLTFLoader` should load them without extra decoders.

## What these tell us
- **Both files are over Forge's limits.** They're above the 5 MB web-trigger payload and far above the 500 KB Custom UI `invoke` limit. Uploads must go **directly to Object Store via a pre-signed URL** (spike 1); there's no path that sends the file through a function.
- **The installable sample needs to be smaller.** Forge app bundle size limits are unverified, so the sample site loaded on install should be a decimated copy (aim for ~2–5 MB: fewer triangles, smaller texture). Keep these originals as the full-resolution evidence.
- **The heights (4.3–4.9 m) look tall for one room.** The scans may include stray geometry or a high ceiling. Check them in a viewer before using them in the demo.

## Not yet captured
- **LAS** point-cloud export of the same scans, to test the point-cloud viewer (optional).
- A note of **what each scan shows**, so we can pin realistic decisions to it.
