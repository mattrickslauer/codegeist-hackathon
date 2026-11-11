import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cspSafeEmbeddedTextures } from './cspSafeTextures.js';

/** Highlight colours (Atlassian palette): equipment with decisions, with a blocked work order, selected. */
const COLOURS = {
  decision: new THREE.Color(0x388bff),
  blocked: new THREE.Color(0xe2483d),
  selected: new THREE.Color(0xffffff),
};

/**
 * ModelViewer: renders a GLB (a bundled building model by URL, or an uploaded LiDAR scan Blob).
 *
 * - Objects whose glTF extras carry a `tag` (equipment, e.g. "RTU-1") are selectable:
 *   click → onSelectTag(tag); click on anything else → onSelectTag(null) + onPick({ point, normal }).
 * - `highlights` { [tag]: 'decision' | 'blocked' } colours equipment; `selectedTag` is emphasised.
 *   Highlight changes recolour in place; the model only reloads when `source` changes.
 */
export default function ModelViewer({ source, highlights = {}, selectedTag = null, onSelectTag, onPick, onReport, onError, height = 520 }) {
  const mountRef = useRef(null);
  const stateRef = useRef({ tagged: new Map(), render: () => {} });
  const callbacks = useRef({});
  callbacks.current = { onSelectTag, onPick, onReport, onError };

  // Scene + model: rebuilt only when the source changes.
  useEffect(() => {
    if (!source?.url && !source?.blob) return undefined;
    const mount = mountRef.current;
    let disposed = false;
    let frame = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d2125);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f45, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / height, 0.05, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff5630 }));
    marker.visible = false;
    scene.add(marker);

    const tagged = new Map(); // tag → [{ mesh, base: { color, emissive } }]
    stateRef.current.tagged = tagged;
    let model = null;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const tagOf = (obj) => { for (let o = obj; o; o = o.parent) if (o.userData?.tag) return o.userData.tag; return null; };
    const hitAt = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      // Prefer equipment even when it sits behind a translucent wall.
      const hits = raycaster.intersectObject(model, true);
      return hits.find((h) => tagOf(h.object)) ?? hits.find((h) => h.object.material?.opacity === undefined || h.object.material.opacity > 0.5) ?? hits[0];
    };

    let downAt = null;
    const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!model || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const hit = hitAt(e);
      const tag = hit ? tagOf(hit.object) : null;
      if (tag) { marker.visible = false; callbacks.current.onSelectTag?.(tag); return; }
      callbacks.current.onSelectTag?.(null);
      if (hit) {
        marker.position.copy(hit.point);
        marker.visible = true;
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
        callbacks.current.onPick?.({ point: hit.point.toArray().map((v) => +v.toFixed(3)), normal: n?.toArray().map((v) => +v.toFixed(3)) ?? null });
      }
    };
    const onMove = (e) => {
      if (!model) return;
      const hit = hitAt(e);
      renderer.domElement.style.cursor = hit && tagOf(hit.object) ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    const onResize = () => {
      camera.aspect = mount.clientWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, height);
    };
    window.addEventListener('resize', onResize);

    const tick = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    (async () => {
      try {
        const t0 = performance.now();
        const buffer = source.blob ? await source.blob.arrayBuffer() : await (await fetch(source.url)).arrayBuffer();
        const loader = new GLTFLoader().register((parser) => cspSafeEmbeddedTextures(parser));
        const gltf = await loader.parseAsync(buffer, '');
        if (disposed) return;
        model = gltf.scene;
        scene.add(model);

        let triangles = 0;
        model.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry;
          triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
          const tag = tagOf(o);
          if (tag) {
            o.material = o.material.clone(); // per-object material so highlights don't bleed
            const list = tagged.get(tag) ?? [];
            list.push({ mesh: o, base: { color: o.material.color.clone() } });
            tagged.set(tag, list);
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = size.length() / 2;
        camera.position.copy(center).add(new THREE.Vector3(radius * 0.9, radius * 0.75, radius * 1.1));
        camera.near = radius / 500;
        camera.far = radius * 20;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.update();
        stateRef.current.applyHighlights?.();
        callbacks.current.onReport?.({
          ms: Math.round(performance.now() - t0), triangles: Math.round(triangles),
          extent: size.toArray().map((v) => +v.toFixed(1)), tags: [...tagged.keys()],
        });
      } catch (err) {
        callbacks.current.onError?.(err);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m?.map?.dispose?.(); m?.dispose?.(); });
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [source?.url, source?.blob, height]);

  // Highlights: recolour tagged equipment in place whenever highlights or selection change.
  useEffect(() => {
    const apply = () => {
      for (const [tag, items] of stateRef.current.tagged) {
        const state = highlights[tag];
        for (const { mesh, base } of items) {
          const m = mesh.material;
          m.color.copy(state ? COLOURS[state] : base.color);
          m.emissive?.copy(tag === selectedTag ? COLOURS.selected : new THREE.Color(0x000000));
          if (m.emissive) m.emissiveIntensity = tag === selectedTag ? 0.45 : 0;
        }
      }
    };
    stateRef.current.applyHighlights = apply;
    apply();
  }, [highlights, selectedTag]);

  return <div ref={mountRef} style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }} />;
}
