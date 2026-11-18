import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { cspSafeEmbeddedTextures } from '../cspSafeTextures.js';
import { NODE_TYPES, blocksFlow, systemColour, systemOfLink, systemOfNode } from '../../../../src/graphSchema.js';
import { scenePositions } from './layout.js';

const RED = new THREE.Color('#F15B50');
const AMBER = new THREE.Color('#FBC828');
const WHITE = new THREE.Color('#ffffff');
const GREEN = new THREE.Color('#4BCE97');
const WAVE_STEP = 0.32; // seconds per hop of the failure wave

const linkKey = (l) => `${l.from}|${l.type}|${l.to}`;

/** Geometry per glyph shape (shared). */
function geometries(r) {
  return {
    box: new THREE.BoxGeometry(r * 1.7, r * 1.7, r * 1.7),
    valve: new THREE.OctahedronGeometry(r * 1.25),
    switch: new THREE.OctahedronGeometry(r * 1.15),
    panel: new THREE.BoxGeometry(r * 1.2, r * 2, r * 0.7),
    source: new THREE.IcosahedronGeometry(r * 1.6, 0),
    area: new THREE.CylinderGeometry(r * 1.6, r * 1.6, r * 0.35, 24),
    loop: new THREE.TorusGeometry(r * 1.2, r * 0.35, 8, 24),
    line: new THREE.CapsuleGeometry(r * 0.45, r * 1.4, 4, 8),
    dot: new THREE.SphereGeometry(r * 0.7, 16, 12),
    circle: new THREE.SphereGeometry(r, 20, 14),
  };
}

/**
 * The systems scene: the building model (optional x-ray), every component as a glyph, every connection as a
 * tube in its system colour with flow particles, plus selection, trace, isolation and the failure wave.
 *
 * Props: source ({url}|{blob}|null), graph (visible subgraph), selected ({kind:'node',id}|{kind:'link',key}),
 * trace ({ids:Set, links:Set}), impact ({ lost: Map(id→depth), failed:Set, startedAt }), isolation (Set of ids),
 * mode ('select'|'connect'|'place'), connectFrom (id), xray (bool), labels ('all'|'smart'),
 * onSelect(sel|null), onPlace(point), onReady({ tags }), onError(err), focusId (fly to it when it changes).
 */
export default function SystemsScene(props) {
  const mountRef = useRef(null);
  const labelsRef = useRef(null);
  const live = useRef({});
  live.current.props = props;
  const s = useRef(null); // scene state shared between effects

  // ---------- Renderer, scene, model (rebuilt when the source changes) ----------
  useEffect(() => {
    const mount = mountRef.current;
    let disposed = false;
    const w = () => mount.clientWidth || 800;
    const h = () => mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w(), h());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d1117');
    scene.fog = new THREE.FogExp2('#0d1117', 0.0);
    scene.add(new THREE.HemisphereLight('#cfe3ff', '#1a1f26', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(45, w() / h(), 0.05, 4000);
    camera.position.set(40, 35, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w(), h()), 0.55, 0.5, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const overlay = new THREE.Group();
    scene.add(overlay);

    const state = {
      renderer, scene, camera, controls, composer, overlay, model: null, modelMats: [], tagCentres: new Map(), bounds: null,
      nodeMeshes: new Map(), linkMeshes: new Map(), particles: null, particleLinks: [], anchors: new Map(), size: 40,
      rubber: null, rings: [], flyTo: null, grid: null,
    };
    s.current = state;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointer = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const tagOf = (obj) => { for (let o = obj; o; o = o.parent) if (o.userData?.tag) return o.userData.tag; return null; };

    /** What's under the pointer: a component, a connection, equipment in the model, or a surface point. */
    const pick = (e) => {
      setPointer(e);
      const nodeHits = raycaster.intersectObjects([...state.nodeMeshes.values()].map((m) => m.userData.hit), false);
      if (nodeHits.length) return { kind: 'node', id: nodeHits[0].object.userData.id };
      const linkHits = raycaster.intersectObjects([...state.linkMeshes.values()].map((m) => m.mesh), false);
      const modelHits = state.model ? raycaster.intersectObject(state.model, true) : [];
      const tagHit = modelHits.find((hh) => tagOf(hh.object));
      if (linkHits.length && (!modelHits.length || linkHits[0].distance < modelHits[0].distance + state.size * 0.02)) {
        return { kind: 'link', key: linkHits[0].object.userData.key };
      }
      if (tagHit) return { kind: 'tag', tag: tagOf(tagHit.object), point: tagHit.point };
      const solid = modelHits.find((hh) => hh.object.visible);
      if (solid) return { kind: 'surface', point: solid.point };
      // Empty space: a point on the ground plane, so places work without a model.
      const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(state.bounds?.min.y ?? 0));
      const p = new THREE.Vector3();
      return raycaster.ray.intersectPlane(ground, p) ? { kind: 'empty', point: p } : { kind: 'empty', point: null };
    };

    let downAt = null;
    const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
      const p = live.current.props;
      const hit = pick(e);
      if (p.mode === 'place') {
        const point = hit.point ?? (hit.kind === 'node' ? null : null);
        if (point) p.onPlace?.({ x: point.x, y: point.y, z: point.z });
        return;
      }
      if (hit.kind === 'node') p.onSelect?.({ kind: 'node', id: hit.id });
      else if (hit.kind === 'link') p.onSelect?.({ kind: 'link', key: hit.key });
      else if (hit.kind === 'tag') {
        const node = p.graph.nodes.find((n) => n.type === 'Equipment' && n.name === hit.tag);
        p.onSelect?.(node ? { kind: 'node', id: node.id } : { kind: 'tag', tag: hit.tag });
      } else p.onSelect?.(null);
    };
    let hoverId = null;
    const onMove = (e) => {
      const p = live.current.props;
      const hit = pick(e);
      const id = hit.kind === 'node' ? hit.id : hit.kind === 'tag' ? p.graph.nodes.find((n) => n.type === 'Equipment' && n.name === hit.tag)?.id : null;
      hoverId = id ?? null;
      state.hoverId = hoverId;
      state.hoverLink = hit.kind === 'link' ? hit.key : null;
      renderer.domElement.style.cursor = p.mode === 'place' ? 'crosshair' : (hit.kind === 'node' || hit.kind === 'link' || hit.kind === 'tag') ? 'pointer' : 'grab';
      // Rubber band while connecting.
      if (p.mode === 'connect' && p.connectFrom && state.anchors.has(p.connectFrom)) {
        const a = state.anchors.get(p.connectFrom);
        const b = id && state.anchors.get(id) ? state.anchors.get(id) : (hit.point ?? null);
        if (b) {
          state.rubber.geometry.setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
          state.rubber.computeLineDistances();
          state.rubber.visible = true;
        }
      } else if (state.rubber) state.rubber.visible = false;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    state.rubber = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.9 }));
    state.rubber.visible = false;
    scene.add(state.rubber);

    const ro = new ResizeObserver(() => {
      camera.aspect = w() / h();
      camera.updateProjectionMatrix();
      renderer.setSize(w(), h());
      composer.setSize(w(), h());
    });
    ro.observe(mount);

    // ---------- Frame loop ----------
    let frame = 0;
    const tmp = new THREE.Vector3();
    const tick = () => {
      if (disposed) return;
      const t = performance.now() / 1000;
      const p = live.current.props;
      if (state.flyTo) {
        const f = state.flyTo;
        f.k = Math.min(1, f.k + 0.045);
        const e = 1 - (1 - f.k) ** 3;
        controls.target.lerpVectors(f.fromT, f.toT, e);
        camera.position.lerpVectors(f.fromC, f.toC, e);
        if (f.k >= 1) state.flyTo = null;
      }
      controls.update();
      animateOverlay(state, p, t);
      composer.render();
      updateLabels(state, p, labelsRef.current, camera, renderer, tmp);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // ---------- Model ----------
    const src = props.source;
    (async () => {
      try {
        if (src?.url || src?.blob) {
          const buffer = src.blob ? await src.blob.arrayBuffer() : await (await fetch(src.url)).arrayBuffer();
          const loader = new GLTFLoader().register((parser) => cspSafeEmbeddedTextures(parser));
          const gltf = await loader.parseAsync(buffer, '');
          if (disposed) return;
          state.model = gltf.scene;
          scene.add(state.model);
          const perTag = new Map();
          state.model.traverse((o) => {
            if (!o.isMesh) return;
            o.material = o.material.clone();
            state.modelMats.push({ mat: o.material, opacity: o.material.opacity ?? 1, transparent: o.material.transparent, color: o.material.color?.clone(), tag: tagOf(o) });
            const tag = tagOf(o);
            if (tag) {
              const b = perTag.get(tag) ?? new THREE.Box3();
              b.expandByObject(o);
              perTag.set(tag, b);
            }
          });
          for (const [tag, b] of perTag) {
            const c = b.getCenter(new THREE.Vector3());
            state.tagCentres.set(tag, { x: c.x, y: b.max.y + (b.max.y - b.min.y) * 0.15, z: c.z });
          }
          const box = new THREE.Box3().setFromObject(state.model);
          state.bounds = { min: box.min.clone(), max: box.max.clone() };
        } else {
          state.bounds = null;
        }
        const size = state.bounds ? Math.max(state.bounds.max.x - state.bounds.min.x, state.bounds.max.y - state.bounds.min.y, state.bounds.max.z - state.bounds.min.z) : 40;
        state.size = size;
        state.rubber.material.dashSize = size * 0.012;
        state.rubber.material.gapSize = size * 0.008;
        const grid = new THREE.GridHelper(size * 3, 60, '#2c333a', '#1d2125');
        grid.position.y = state.bounds?.min.y ?? 0;
        grid.material.transparent = true;
        grid.material.opacity = 0.6;
        scene.add(grid);
        state.grid = grid;
        const centre = state.bounds ? new THREE.Vector3().addVectors(state.bounds.min, state.bounds.max).multiplyScalar(0.5) : new THREE.Vector3(0, 6, 0);
        camera.position.copy(centre).add(new THREE.Vector3(size * 0.85, size * 0.7, size * 1.05));
        camera.near = size / 800;
        camera.far = size * 30;
        camera.updateProjectionMatrix();
        controls.target.copy(centre);
        controls.update();
        state.ready = true;
        live.current.rebuild?.();
        applyXray(state, live.current.props.xray);
        live.current.props.onReady?.({ tags: [...state.tagCentres.keys()] });
      } catch (err) {
        live.current.props.onError?.(err);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m?.map?.dispose?.(); m?.dispose?.(); });
      });
      composer.dispose?.();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      s.current = null;
    };
  }, [props.source?.url, props.source?.blob]);

  // ---------- Overlay: rebuilt when the drawn graph changes ----------
  useEffect(() => {
    const rebuild = () => {
      const state = s.current;
      if (!state?.ready) return;
      buildOverlay(state, props.graph);
    };
    live.current.rebuild = rebuild;
    rebuild();
  }, [props.graph]);

  useEffect(() => { if (s.current?.ready) applyXray(s.current, props.xray); }, [props.xray]);

  // Fly to a component when asked.
  useEffect(() => {
    const state = s.current;
    if (!state?.ready || !props.focusId) return;
    const a = state.anchors.get(props.focusId);
    if (!a) return;
    const toT = new THREE.Vector3(a.x, a.y, a.z);
    const dir = state.camera.position.clone().sub(state.controls.target).normalize();
    const dist = Math.max(state.size * 0.28, Math.min(state.camera.position.distanceTo(state.controls.target), state.size * 0.6));
    state.flyTo = { k: 0, fromT: state.controls.target.clone(), toT, fromC: state.camera.position.clone(), toC: toT.clone().add(dir.multiplyScalar(dist)) };
  }, [props.focusId, props.focusNonce]);

  return (
    <div className="sx-scene" ref={mountRef}>
      <div className="sx-labels" ref={labelsRef} />
    </div>
  );
}

/** X-ray: the building fades to a cool translucent shell so the systems read through it. */
function applyXray(state, on) {
  for (const m of state.modelMats) {
    if (on && !m.tag) {
      m.mat.transparent = true;
      m.mat.opacity = Math.min(m.opacity, 0.07);
      m.mat.depthWrite = false;
      m.mat.color?.set('#3d5f99');
    } else {
      m.mat.transparent = m.transparent;
      m.mat.opacity = m.opacity;
      m.mat.depthWrite = true;
      if (m.color) m.mat.color.copy(m.color);
    }
    m.mat.needsUpdate = true;
  }
}

/** Build component glyphs, connection tubes and flow particles. */
function buildOverlay(state, graph) {
  const { overlay } = state;
  for (const child of [...overlay.children]) {
    overlay.remove(child);
    child.traverse?.((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
  state.nodeMeshes.clear();
  state.linkMeshes.clear();

  const anchors = scenePositions(graph, state.tagCentres, state.bounds);
  state.anchors = anchors;
  const r = state.size * 0.0065;
  const geos = geometries(r);
  const hitGeo = new THREE.SphereGeometry(r * 2.2, 8, 6);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const n of graph.nodes) {
    const a = anchors.get(n.id);
    if (!a) continue;
    const sys = systemOfNode(n);
    const colour = new THREE.Color(sys ? systemColour(sys) : n.type === 'Equipment' ? '#E9F2FF' : '#B3B9C4');
    const shape = NODE_TYPES[n.type]?.shape ?? 'circle';
    const mat = new THREE.MeshStandardMaterial({ color: colour, emissive: colour.clone(), emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.1, transparent: true, opacity: a.placed === 'floating' ? 0.9 : 1 });
    const mesh = new THREE.Mesh(geos[shape] ?? geos.circle, mat);
    mesh.position.set(a.x, a.y, a.z);
    const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.id = n.id;
    mesh.add(hit);
    mesh.userData = { id: n.id, base: colour, hit, floating: a.placed === 'floating', blocks: blocksFlow(n), node: n };
    // A halo ring for selection / failure.
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 2.1, r * 2.6, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.userData.isRing = true;
    mesh.add(ring);
    mesh.userData.ring = ring;
    // Floating components hang a faint drop line to the roof so their height reads as "not placed yet".
    if (a.placed === 'floating' && state.bounds) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, state.bounds.max.y - a.y, 0)]);
      const drop = new THREE.Line(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.12 }));
      mesh.add(drop);
    }
    overlay.add(mesh);
    state.nodeMeshes.set(n.id, mesh);
  }

  const particleSlots = [];
  const tubeR = state.size * 0.0016;
  for (const l of graph.links) {
    const a = anchors.get(l.from);
    const b = anchors.get(l.to);
    if (!a || !b) continue;
    const sys = systemOfLink(l, nodesById);
    const colour = new THREE.Color(systemColour(sys));
    const A3 = new THREE.Vector3(a.x, a.y, a.z);
    const B3 = new THREE.Vector3(b.x, b.y, b.z);
    const mid = A3.clone().lerp(B3, 0.5);
    mid.y += A3.distanceTo(B3) * 0.18; // gentle arc reads better than straight lines through the building
    const curve = new THREE.QuadraticBezierCurve3(A3, mid, B3);
    const sizeIn = Number(l.attrs?.sizeIn?.value) || 0;
    const radius = tubeR * (sizeIn ? Math.min(2.4, 0.8 + sizeIn / 4) : l.type === 'serves' ? 0.6 : 1);
    const geo = new THREE.TubeGeometry(curve, 24, radius, 6, false);
    const dashed = l.type === 'serves' || l.type === 'connects' || l.type === 'controls' || l.type === 'supportedBy';
    const mat = new THREE.MeshStandardMaterial({ color: colour, emissive: colour.clone(), emissiveIntensity: 0.35, transparent: true, opacity: dashed ? 0.35 : 0.75, roughness: 0.4, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    const key = linkKey(l);
    mesh.userData.key = key;
    overlay.add(mesh);
    state.linkMeshes.set(key, { mesh, curve, base: colour, link: l, dashed });
    if (!dashed) {
      const len = A3.distanceTo(B3);
      const count = Math.max(1, Math.min(4, Math.round(len / (state.size * 0.12))));
      for (let i = 0; i < count; i += 1) particleSlots.push({ key, curve, offset: i / count, colour, speed: 0.18 + (sizeIn ? 0 : 0.05) });
    }
  }

  const pg = new THREE.SphereGeometry(tubeR * 2.3, 8, 6);
  const pm = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const particles = new THREE.InstancedMesh(pg, pm, Math.max(1, particleSlots.length));
  particles.count = particleSlots.length;
  particleSlots.forEach((p, i) => particles.setColorAt(i, p.colour.clone().multiplyScalar(1.6)));
  if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
  overlay.add(particles);
  state.particles = particles;
  state.particleLinks = particleSlots;
}

/** Per-frame: selection, hover, trace, isolation, failure wave, particle flow. */
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
function animateOverlay(state, p, t) {
  const impact = p.impact;
  const since = impact ? (performance.now() - impact.startedAt) / 1000 : 0;
  const lostNow = (id) => impact && impact.lost.has(id) && since >= impact.lost.get(id) * WAVE_STEP;
  const dim = Boolean(p.trace || impact || p.isolation);
  const selectedId = p.selected?.kind === 'node' ? p.selected.id : null;
  const selectedLink = p.selected?.kind === 'link' ? p.selected.key : null;

  for (const [id, mesh] of state.nodeMeshes) {
    const mat = mesh.material;
    const ring = mesh.userData.ring;
    ring.lookAt(state.camera.position);
    let colour = mesh.userData.base;
    let intensity = 0.55;
    let scale = 1;
    let ringOpacity = 0;
    let ringColour = WHITE;
    const inTrace = p.trace?.ids.has(id);
    const isolating = p.isolation?.has(id);
    if (mesh.userData.blocks) { colour = AMBER; }
    if (dim && !inTrace && !isolating && !(impact && impact.lost.has(id))) { intensity = 0.08; mat.opacity = 0.25; } else mat.opacity = mesh.userData.floating ? 0.9 : 1;
    if (inTrace) intensity = 0.9;
    if (isolating) {
      colour = AMBER;
      intensity = 1.4 + Math.sin(t * 6) * 0.5;
      ringOpacity = 0.8;
      ringColour = AMBER;
      scale = 1.25;
    }
    if (impact && impact.lost.has(id)) {
      const d = impact.lost.get(id);
      const k = since - d * WAVE_STEP;
      if (k >= 0) {
        colour = RED;
        intensity = 1.2 + Math.max(0, 1.5 - k * 2);
        scale = 1 + Math.max(0, 0.6 - k) * 1.2;
        ringOpacity = Math.max(0, 0.9 - k * 0.6);
        ringColour = RED;
        ring.scale.setScalar(1 + k * 2.2);
      } else { intensity = 0.25; }
      if (impact.failed.has(id)) { ringOpacity = Math.max(ringOpacity, 0.4 + 0.3 * Math.sin(t * 5)); ring.scale.setScalar(1 + (t * 0.8) % 1.5); }
    } else if (!isolating) ring.scale.setScalar(1);
    if (id === selectedId || id === state.hoverId || id === p.connectFrom) {
      ringOpacity = Math.max(ringOpacity, id === selectedId || id === p.connectFrom ? 0.95 : 0.5);
      if (!impact?.lost.has(id) && !isolating) ringColour = id === p.connectFrom ? GREEN : WHITE;
      intensity = Math.max(intensity, 1.0);
      scale = Math.max(scale, id === selectedId ? 1.35 + Math.sin(t * 4) * 0.08 : 1.15);
    }
    mat.color.copy(colour);
    mat.emissive.copy(colour);
    mat.emissiveIntensity = intensity;
    mesh.scale.setScalar(scale);
    ring.material.opacity = ringOpacity;
    ring.material.color.copy(ringColour);
  }

  for (const [key, entry] of state.linkMeshes) {
    const { mesh, base, link, dashed } = entry;
    const mat = mesh.material;
    let colour = base;
    let opacity = dashed ? 0.35 : 0.75;
    let intensity = 0.35;
    if (dim) { opacity = 0.08; intensity = 0.05; }
    if (p.trace?.links.has(key)) { opacity = 0.95; intensity = 1.1; }
    if (impact && lostNow(link.to) && (impact.lost.has(link.from) || impact.failed.has(link.from))) {
      colour = RED; opacity = 0.9; intensity = 1.0;
    }
    if (key === selectedLink || key === state.hoverLink) { opacity = 1; intensity = 1.6; }
    mat.color.copy(colour);
    mat.emissive.copy(colour);
    mat.emissiveIntensity = intensity;
    mat.opacity = opacity;
  }

  // Flow particles: travel along live connections; they stop (and vanish) where supply is lost.
  const ps = state.particles;
  if (ps) {
    state.particleLinks.forEach((slot, i) => {
      const entry = state.linkMeshes.get(slot.key);
      const l = entry?.link;
      const dead = impact && l && (lostNow(l.from) || (impact.failed.has(l.from) && since > 0));
      const traced = !p.trace || p.trace.links.has(slot.key);
      const visible = !dead && traced && !(dim && !p.trace);
      const u = (slot.offset + t * slot.speed) % 1;
      slot.curve.getPointAt(u, _v);
      _m.makeScale(visible ? 1 : 0, visible ? 1 : 0, visible ? 1 : 0);
      _m.setPosition(_v);
      ps.setMatrixAt(i, _m);
    });
    ps.instanceMatrix.needsUpdate = true;
  }
}

/** HTML labels: selected, hovered, connecting, failed and isolating components, plus equipment when zoomed in. */
function updateLabels(state, p, el, camera, renderer, tmp) {
  if (!el) return;
  const want = new Map();
  const add = (id, cls) => { if (state.anchors.has(id)) want.set(id, cls); };
  if (p.labels === 'all') for (const id of state.nodeMeshes.keys()) add(id, 'sx-label');
  if (p.impact) for (const id of p.impact.failed) add(id, 'sx-label sx-label-red');
  if (p.isolation) for (const id of p.isolation) add(id, 'sx-label sx-label-amber');
  if (p.selected?.kind === 'node') add(p.selected.id, 'sx-label sx-label-strong');
  if (p.connectFrom) add(p.connectFrom, 'sx-label sx-label-green');
  if (state.hoverId) add(state.hoverId, want.get(state.hoverId) ?? 'sx-label sx-label-strong');
  const existing = new Map([...el.children].map((c) => [c.dataset.id, c]));
  const r = renderer.domElement;
  for (const [id, cls] of want) {
    const a = state.anchors.get(id);
    tmp.set(a.x, a.y, a.z).project(camera);
    let div = existing.get(id);
    if (!div) {
      div = document.createElement('div');
      div.dataset.id = id;
      el.appendChild(div);
    }
    existing.delete(id);
    const node = state.nodeMeshes.get(id)?.userData.node;
    const text = node ? node.name : id;
    if (div.textContent !== text) div.textContent = text;
    if (div.className !== cls) div.className = cls;
    const hidden = tmp.z > 1;
    div.style.display = hidden ? 'none' : 'block';
    div.style.transform = `translate(-50%, -140%) translate(${((tmp.x + 1) / 2) * r.clientWidth}px, ${((1 - tmp.y) / 2) * r.clientHeight}px)`;
  }
  for (const div of existing.values()) div.remove();
}
