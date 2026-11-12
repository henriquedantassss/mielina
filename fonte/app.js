// Mielina by Quíron: visualizador 3D do sistema nervoso.
// Dados: Z-Anatomy (CC BY-SA 4.0), derivado do BodyParts3D (DBCLS, CC BY 4.0) e do Brain for Blender (A. M. Winkler).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

const $ = (s) => document.querySelector(s);
const META = JSON.parse($('#meta').textContent);
const ROWS = META.rows; // estruturas com malha
const GROUPS = META.groups; // grupos da hierarquia
const N = ROWS.length;
const isTouch = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Categorias (camadas) ----------
const CATS = [
  { id: 'cortex', pt: 'Córtex cerebral', color: '#7FA6E6' },
  { id: 'branca', pt: 'Substância branca', color: '#ECE6D8' },
  { id: 'nucleos', pt: 'Núcleos profundos', color: '#F2A65A' },
  { id: 'ventriculos', pt: 'Ventrículos e líquor', color: '#45D4E0' },
  { id: 'tronco', pt: 'Tronco encefálico', color: '#D9B8B0' },
  { id: 'cerebelo', pt: 'Cerebelo', color: '#E7A79C' },
  { id: 'medula', pt: 'Medula espinal e tratos', color: '#E8E2D4' },
  { id: 'meninges', pt: 'Meninges', color: '#8FB6D9' },
  { id: 'cranianos', pt: 'Nervos cranianos', color: '#FFB86B' },
  { id: 'espinais', pt: 'Nervos espinais e plexos', color: '#F2C462' },
  { id: 'autonomo', pt: 'Sistema autônomo', color: '#5FD6A0' },
  { id: 'sentidos', pt: 'Olho e orelha', color: '#C9D3DF' },
];
const MODES = ['solido', 'vidro', 'oculto'];
const MODE_PT = { solido: 'Sólido', vidro: 'Vidro', oculto: 'Oculto' };
const catMode = {};

// ---------- Renderizador ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const DPR = Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 2);
renderer.setPixelRatio(DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 20);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// fundo: gradiente escuro do laboratório
function makeBackground() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#0E1824'); gr.addColorStop(0.55, '#0A121B'); gr.addColorStop(1, '#070C12');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
scene.background = makeBackground();

const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.6, 1.2, 1.4); scene.add(key);
const rim = new THREE.DirectionalLight(0x8fb4ff, 1.1); rim.position.set(-1.2, 0.6, -1.4); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1410, 0.5));
scene.add(key.target, rim.target);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.rotateSpeed = isTouch ? 0.7 : 0.6; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
controls.minDistance = 0.04; controls.maxDistance = 6;
controls.screenSpacePanning = true;

// ---------- Pós-processamento ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- Textura de estado: cor + visibilidade por estrutura ----------
const TW = 64, TH = Math.ceil(N / TW);
const stateData = new Uint8Array(TW * TH * 4);
const flagData = new Uint8Array(TW * TH * 4);
const stateTex = new THREE.DataTexture(stateData, TW, TH, THREE.RGBAFormat); stateTex.needsUpdate = true;
const flagTex = new THREE.DataTexture(flagData, TW, TH, THREE.RGBAFormat); flagTex.needsUpdate = true;
const baseColor = ROWS.map((r) => new THREE.Color(r.color));

const shared = {
  uState: { value: stateTex }, uFlags: { value: flagTex }, uTexSize: { value: new THREE.Vector2(TW, TH) },
  uClip: { value: new THREE.Vector4(0, 0, 0, 0) }, uClipOn: { value: 0 }, uTime: { value: 0 },
  uRim: { value: new THREE.Color('#5E8FFF') },
};

const VERT_HEAD = /* glsl */`
attribute float sid;
uniform sampler2D uState; uniform sampler2D uFlags; uniform vec2 uTexSize;
varying vec4 vState; varying vec4 vFlags; varying vec3 vWorld;
`;
const VERT_STATE = /* glsl */`
{
  vec2 suv = vec2((mod(sid, uTexSize.x) + 0.5) / uTexSize.x, (floor(sid / uTexSize.x) + 0.5) / uTexSize.y);
  vState = texture2D(uState, suv); vFlags = texture2D(uFlags, suv);
}
`;

function makeNervousMaterial(pass) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.0, side: THREE.DoubleSide });
  if (pass === 'glass') { m.transparent = true; m.depthWrite = false; }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { uPass: { value: pass === 'glass' ? 1 : 0 } });
    sh.vertexShader = VERT_HEAD + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_STATE)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        gl_Position.z += vFlags.a * 0.00025 * gl_Position.w;
        float a = vState.a * 255.0; // 0 oculto, 1 vidro, 2 sólido
        bool want = (uPass == 0) ? (a > 1.5) : (a > 0.5 && a < 1.5);
        if (!want) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`)
      .replace('void main() {', 'uniform int uPass;\nvoid main() {');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `uniform vec4 uClip; uniform float uClipOn; uniform float uTime; uniform vec3 uRim; uniform int uPass;
        varying vec4 vState; varying vec4 vFlags; varying vec3 vWorld;
        void main() {
        if (uClipOn > 0.5 && dot(vWorld, uClip.xyz) > uClip.w) discard;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec3 baseCol = pow(vState.rgb, vec3(2.2));
        float dimmed = vFlags.b;
        baseCol = mix(baseCol, baseCol * 0.18 + vec3(0.012, 0.018, 0.03), dimmed * 0.85);
        vec4 diffuseColor = vec4(baseCol, uPass == 1 ? 0.16 : 1.0);
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 V = normalize(cameraPosition - vWorld);
          float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition) * -1.0)), 3.0);
          float sel = vFlags.r; float hov = vFlags.g;
          float pulse = 0.75 + 0.25 * sin(uTime * 3.0);
          totalEmissiveRadiance += uRim * fr * (uPass == 1 ? 0.55 : 0.22) * (1.0 - dimmed * 0.8);
          totalEmissiveRadiance += vec3(0.55, 0.78, 1.0) * fr * sel * 2.4 * pulse;
          totalEmissiveRadiance += baseCol * sel * (0.45 + 0.25 * pulse);
          totalEmissiveRadiance += vec3(0.5, 0.7, 1.0) * fr * hov * 1.2;
          if (uPass == 1) diffuseColor.a = clamp(0.10 + fr * 0.55, 0.0, 0.9) * (1.0 - dimmed * 0.72);
        }`);
  };
  m.customProgramCacheKey = () => 'nerv-' + pass;
  return m;
}

// fantasma do corpo (pele e ossos): só o contorno aceso
function makeGhostMaterial(color, strength, fill) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uFill: { value: fill }, uClip: shared.uClip, uClipOn: shared.uClipOn },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uStrength; uniform float uFill; uniform vec4 uClip; uniform float uClipOn;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ if (uClipOn > 0.5 && dot(vW, uClip.xyz) > uClip.w) discard;
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = pow(f, 2.6) * uStrength + uFill;
        gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ---------- Leitura dos dados ----------
async function loadGeometry(onProgress) {
  const b64 = $('#geo').textContent.trim();
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  onProgress(0.25);
  const ds = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  const raw = new Uint8Array(await new Response(ds).arrayBuffer());
  onProgress(0.5);
  await MeshoptDecoder.ready;
  const geos = {};
  for (const [name, L] of Object.entries(META.geo.layers)) {
    const vb = new Uint8Array(L.vc * 12);
    MeshoptDecoder.decodeVertexBuffer(vb, L.vc, 12, raw.subarray(L.v[0], L.v[0] + L.v[1]));
    const ib = new Uint32Array(L.ic);
    MeshoptDecoder.decodeIndexBuffer(new Uint8Array(ib.buffer), L.ic, 4, raw.subarray(L.i[0], L.i[0] + L.i[1]));
    const g = new THREE.BufferGeometry();
    const i16 = new THREE.InterleavedBuffer(new Int16Array(vb.buffer), 6);
    const u16 = new THREE.InterleavedBuffer(new Uint16Array(vb.buffer), 6);
    const i8 = new THREE.InterleavedBuffer(new Int8Array(vb.buffer), 12);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(i16, 3, 0, true));
    g.setAttribute('sid', new THREE.InterleavedBufferAttribute(u16, 1, 3, false));
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(i8, 3, 8, true));
    g.setIndex(new THREE.BufferAttribute(ib, 1));
    geos[name] = { g, vb, ib, vc: L.vc };
    onProgress(0.5 + 0.15 * Object.keys(geos).length);
  }
  return geos;
}

// posição quantizada -> metros
const QB = META.geo.bounds; const QE = QB.ext;
const QS = QE * 32767 / 65535; const QO = QB.min.map((m) => m + QE * 32768 / 65535);
function placeQuantized(obj) { obj.scale.setScalar(QS); obj.position.set(QO[0], QO[1], QO[2]); }

// caixas e centros de cada estrutura, calculados uma vez
const boxes = ROWS.map(() => new THREE.Box3());
function computeBoxes(geo) {
  const i16 = new Int16Array(geo.vb.buffer); const u16 = new Uint16Array(geo.vb.buffer);
  const v = new THREE.Vector3();
  for (let i = 0; i < geo.vc; i++) {
    const o = i * 6; const s = u16[o + 3];
    v.set(i16[o] / 32767 * QS + QO[0], i16[o + 1] / 32767 * QS + QO[1], i16[o + 2] / 32767 * QS + QO[2]);
    boxes[s].expandByPoint(v);
  }
}

// ---------- Hierarquia ----------
const byId = new Map(ROWS.map((r, i) => [r.id, i]));
const childrenOf = new Map(); // grupo -> estruturas (todas as descendentes)
ROWS.forEach((r, i) => {
  for (const g of r.path) { if (!childrenOf.has(g)) childrenOf.set(g, []); childrenOf.get(g).push(i); }
});
// estruturas que também são "pais" de outras estruturas
const structKids = new Map();
ROWS.forEach((r, i) => { for (const p of r.path) if (byId.has(p)) { if (!structKids.has(p)) structKids.set(p, []); structKids.get(p).push(i); } });
function membersOf(key) {
  if (byId.has(key)) return [byId.get(key), ...(structKids.get(key) || [])];
  return childrenOf.get(key) || [];
}
function nameOf(key) {
  if (byId.has(key)) return ROWS[byId.get(key)].pt;
  return GROUPS[key] ? GROUPS[key].pt : key;
}
function boxOf(list) { const b = new THREE.Box3(); for (const i of list) b.union(boxes[i]); return b; }

// ---------- Estado da cena ----------
const hidden = new Set(); let isolated = null; // conjunto de índices isolados
let selected = null; // { key, list }
let hovered = -1;
let ghostSkin = true, ghostBone = true;

function refreshState() {
  const selSet = selected ? new Set(selected.list) : null;
  for (let i = 0; i < N; i++) {
    const r = ROWS[i]; const c = baseColor[i];
    let mode = catMode[r.cat];
    if (hidden.has(i)) mode = 'oculto';
    if (isolated) mode = isolated.has(i) ? (mode === 'oculto' && !hidden.has(i) ? 'solido' : mode) : 'oculto';
    let a = mode === 'solido' ? 2 : mode === 'vidro' ? 1 : 0;
    // modo foco: com algo selecionado, o resto vira vidro para a seleção nunca ficar escondida
    if (selSet && dimOthers && a === 2 && !selSet.has(i)) a = 1;
    const o = i * 4;
    stateData[o] = Math.round(c.r * 255); stateData[o + 1] = Math.round(c.g * 255); stateData[o + 2] = Math.round(c.b * 255); stateData[o + 3] = a;
    flagData[o] = selSet && selSet.has(i) ? 255 : 0;
    flagData[o + 1] = i === hovered ? 255 : 0;
    flagData[o + 2] = selSet && !selSet.has(i) && dimOthers ? 255 : 0;
    flagData[o + 3] = depthBias[i];
  }
  stateTex.needsUpdate = true; flagTex.needsUpdate = true;
  needsRender = true;
}
let dimOthers = true;
// estruturas que ficam por dentro de outra com a mesma superfície (tratos e cinzenta da medula)
const depthBias = ROWS.map((r) => (r.cat === 'medula' && !/^white_matter_of_spinal_cord/.test(r.id) && !/central_canal/.test(r.id) ? 1 : 0));

// ---------- Câmera ----------
const isPhone = () => window.innerWidth <= 760;
function freeArea() {
  const w = window.innerWidth, h = window.innerHeight;
  if (isPhone()) {
    const sheet = ui.info.classList.contains('open') ? Math.min(h * 0.46, ui.info.offsetHeight || h * 0.4) + 86 : 86;
    const top = 60; return { x: 0, y: (sheet - top) / 2, w, h: h - sheet - top };
  }
  const left = 324, right = ui.info.classList.contains('open') ? 372 : 0, top = 70, bottom = 70;
  return { x: (left - right) / 2, y: (bottom - top) / 2, w: w - left - right, h: h - top - bottom };
}
const view = { x: 0, y: 0 };
function applyView() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.setViewOffset(w, h, -view.x, view.y, w, h);
}
let anim = null;
function flyTo(box, opts = {}) {
  const center = box.getCenter(new THREE.Vector3());
  const dir = (opts.dir ? opts.dir.clone() : camera.position.clone().sub(controls.target)).normalize();
  // base da câmera para essa direção
  const up0 = Math.abs(dir.y) > 0.98 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up0, dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  let hw = 0, hh = 0, hd = 0; const c = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    hw = Math.max(hw, Math.abs(c.dot(right))); hh = Math.max(hh, Math.abs(c.dot(up))); hd = Math.max(hd, Math.abs(c.dot(dir)));
  }
  const pad = opts.pad || 1.1; hw = Math.max(hw, 0.01) * pad; hh = Math.max(hh, 0.01) * pad;
  const fov = THREE.MathUtils.degToRad(camera.fov); const fa = freeArea(); const H = window.innerHeight;
  const tanV = Math.tan(fov / 2);
  const dist = Math.max(hh / (tanV * Math.max(0.3, fa.h / H)), hw / (tanV * Math.max(0.3, fa.w / H))) + hd;
  const toPos = center.clone().add(dir.multiplyScalar(dist));
  const from = { p: camera.position.clone(), t: controls.target.clone() };
  const dur = reduceMotion ? 0 : (opts.dur ?? 1100);
  anim = { from, to: { p: toPos, t: center }, t0: performance.now(), dur };
  needsRender = true;
}
function stepAnim(now) {
  if (!anim) return;
  const k = anim.dur ? Math.min(1, (now - anim.t0) / anim.dur) : 1;
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  // arco suave: interpola direção e distância separadamente
  const t = anim.from.t.clone().lerp(anim.to.t, e);
  const d0 = anim.from.p.clone().sub(anim.from.t), d1 = anim.to.p.clone().sub(anim.to.t);
  const len = THREE.MathUtils.lerp(d0.length(), d1.length(), e);
  const dir = d0.normalize().lerp(d1.normalize(), e).normalize();
  controls.target.copy(t); camera.position.copy(t).add(dir.multiplyScalar(len));
  if (k >= 1) anim = null;
}
const DIR = {
  frente: new THREE.Vector3(0.18, 0.08, 1), tres4: new THREE.Vector3(0.75, 0.25, 1), lado: new THREE.Vector3(1, 0.08, 0.04),
  ladoD: new THREE.Vector3(-1, 0.1, 0.12), cima: new THREE.Vector3(0.05, 1, 0.35), baixo: new THREE.Vector3(0.1, -0.75, 1), tras: new THREE.Vector3(-0.3, 0.15, -1),
};

// ---------- Corte ----------
let clip = { axis: 'nenhum', t: 0.5 };
let clipBox = null;
function applyClip() {
  if (clip.axis === 'nenhum') { shared.uClipOn.value = 0; needsRender = true; return; }
  const b = clipBox || boxOf(ROWS.map((_, i) => i));
  const n = clip.axis === 'sagital' ? new THREE.Vector3(1, 0, 0) : clip.axis === 'coronal' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const ax = clip.axis === 'sagital' ? 'x' : clip.axis === 'coronal' ? 'z' : 'y';
  const w = THREE.MathUtils.lerp(b.min[ax], b.max[ax], clip.t);
  shared.uClip.value.set(n.x, n.y, n.z, w); shared.uClipOn.value = 1; needsRender = true;
}

// ---------- Seleção por GPU ----------
const pickTarget = new THREE.WebGLRenderTarget(1, 1);
const pickMat = new THREE.ShaderMaterial({
  uniforms: { uState: shared.uState, uFlags: shared.uFlags, uTexSize: shared.uTexSize, uClip: shared.uClip, uClipOn: shared.uClipOn },
  vertexShader: VERT_HEAD + /* glsl */`
    varying float vSid;
    void main(){ ${VERT_STATE}
      vSid = sid;
      vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
      if (vState.a * 255.0 < 1.5) gl_Position = vec4(0.0,0.0,-2.0,1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec4 uClip; uniform float uClipOn; varying vec3 vWorld; varying float vSid;
    void main(){ if (uClipOn > 0.5 && dot(vWorld, uClip.xyz) > uClip.w) discard;
      float s = floor(vSid + 0.5) + 1.0;
      gl_FragColor = vec4(mod(s, 256.0) / 255.0, floor(s / 256.0) / 255.0, 0.0, 1.0); }`,
  side: THREE.DoubleSide,
});
const pickScene = new THREE.Scene();
const pickPixel = new Uint8Array(4);
let pickMesh = null;
function pickAt(x, y) {
  if (!pickMesh) return -1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  camera.setViewOffset(w, h, Math.round(x - view.x), Math.round(y + view.y), 1, 1);
  renderer.setRenderTarget(pickTarget);
  renderer.setClearColor(0x000000, 0); renderer.clear();
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  renderer.render(pickScene, camera);
  renderer.toneMapping = tm;
  renderer.setRenderTarget(null);
  applyView();
  renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, pickPixel);
  const id = pickPixel[0] + pickPixel[1] * 256 - 1;
  return id >= 0 && id < N ? id : -1;
}

// ---------- Interface ----------
const ui = {
  info: $('#info'), infoName: $('#info-name'), infoLat: $('#info-lat'), infoEn: $('#info-en'), infoMeta: $('#info-meta'),
  infoNote: $('#info-note'), infoPath: $('#info-path'), infoKids: $('#info-kids'), tip: $('#tip'), label: $('#label'),
};

function fmtCm(m) { return (m * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }); }
const SIDE_PT = { left: 'esquerdo', right: 'direito' };
const CAT_PT = Object.fromEntries(CATS.map((c) => [c.id, c.pt]));
const baseKey = (id) => id.replace(/_(l|r)$/, '');

function select(key, opts = {}) {
  const list = membersOf(key);
  if (!list.length) return;
  selected = { key, list };
  refreshState();
  showInfo(key, list);
  if (opts.fly !== false) { const sz = boxOf(list).getSize(new THREE.Vector3()).length(); flyTo(boxOf(list), { pad: sz < 0.05 ? 3.4 : sz < 0.15 ? 2.0 : 1.25, dur: opts.dur }); }
  setHash(key);
}
function clearSelection() {
  selected = null; refreshState(); ui.info.classList.remove('open'); ui.label.classList.remove('on'); setHash('');
}

function showInfo(key, list) {
  const isStruct = byId.has(key);
  const r = isStruct ? ROWS[byId.get(key)] : null;
  const g = !isStruct ? GROUPS[key] : null;
  ui.infoName.textContent = nameOf(key);
  ui.infoLat.textContent = (r ? r.la : g && g.la) || '';
  ui.infoLat.hidden = !ui.infoLat.textContent;
  ui.infoEn.textContent = (r ? r.en : g && g.en) || '';
  const b = boxOf(list); const s = b.getSize(new THREE.Vector3());
  const meta = [];
  if (r) {
    meta.push(['Camada', CAT_PT[r.cat]]);
    if (r.side) meta.push(['Lado', SIDE_PT[r.side]]);
    else meta.push(['Lado', 'linha média ou os dois']);
  } else {
    meta.push(['Grupo', `${list.length} ${list.length === 1 ? 'estrutura' : 'estruturas'}`]);
  }
  meta.push(['Tamanho no modelo', `${fmtCm(s.x)} × ${fmtCm(s.y)} × ${fmtCm(s.z)} cm`]);
  ui.infoMeta.innerHTML = meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const note = META.fichas[baseKey(key)] || (r && META.fichas[r.path[r.path.length - 1]]) || '';
  ui.infoNote.textContent = note; ui.infoNote.hidden = !note;
  // caminho na hierarquia (cada parte é clicável)
  const path = r ? r.path : pathOfGroup(key);
  ui.infoPath.innerHTML = '';
  path.forEach((p, i) => {
    if (!GROUPS[p] && !byId.has(p)) return;
    const a = document.createElement('button'); a.className = 'crumb'; a.textContent = nameOf(p);
    a.onclick = () => select(p);
    ui.infoPath.appendChild(a);
  });
  ui.infoPath.hidden = !ui.infoPath.children.length;
  // partes (filhos diretos)
  const kids = directChildren(key);
  ui.infoKids.innerHTML = '';
  if (kids.length) {
    const h = document.createElement('div'); h.className = 'kids-h'; h.textContent = `Partes (${kids.length})`; ui.infoKids.appendChild(h);
    for (const k of kids) {
      const b2 = document.createElement('button'); b2.className = 'kid';
      const first = membersOf(k)[0];
      b2.innerHTML = `<i style="background:${ROWS[first].color}"></i><span>${nameOf(k)}${sideTag(k)}</span>`;
      b2.onclick = () => select(k);
      b2.onmouseenter = () => { hoverList(membersOf(k)); };
      b2.onmouseleave = () => { hoverList(null); };
      ui.infoKids.appendChild(b2);
    }
  }
  ui.info.classList.add('open');
  ui.info.scrollTop = 0;
}
function sideTag(k) { if (!byId.has(k)) return ''; const s = ROWS[byId.get(k)].side; return s ? ` <em>${s === 'left' ? 'esq.' : 'dir.'}</em>` : ''; }
function pathOfGroup(key) { const out = []; let p = GROUPS[key] && GROUPS[key].parent; while (p) { out.unshift(p); p = GROUPS[p] && GROUPS[p].parent; } return out.slice(1); }
const groupKids = new Map();
for (const [k, g] of Object.entries(GROUPS)) { if (g.parent) { if (!groupKids.has(g.parent)) groupKids.set(g.parent, []); groupKids.get(g.parent).push(k); } }
ROWS.forEach((r) => { const p = r.path[r.path.length - 1]; if (p) { if (!groupKids.has(p)) groupKids.set(p, []); groupKids.get(p).push(r.id); } });
function directChildren(key) {
  return (groupKids.get(key) || []).filter((k) => membersOf(k).length > 0)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'pt') || (a < b ? -1 : 1));
}
let hoverSet = null;
function hoverList(list) {
  for (let i = 0; i < N; i++) flagData[i * 4 + 1] = 0;
  if (list) for (const i of list) flagData[i * 4 + 1] = 255;
  else if (hovered >= 0) flagData[hovered * 4 + 1] = 255;
  hoverSet = list; flagTex.needsUpdate = true; needsRender = true;
}

// ---------- Camadas ----------
function buildLayers() {
  const box = $('#layers');
  box.innerHTML = '';
  for (const c of CATS) {
    const row = document.createElement('div'); row.className = 'layer';
    row.innerHTML = `<button class="layer-name" title="Selecionar"><i style="background:${c.color}"></i>${c.pt}</button>
      <div class="seg" role="group" aria-label="${c.pt}">${MODES.map((m) => `<button data-m="${m}" aria-label="${MODE_PT[m]}" title="${MODE_PT[m]}"><span class="ico ico-${m}"></span></button>`).join('')}</div>`;
    row.querySelector('.layer-name').onclick = () => {
      const list = ROWS.map((r, i) => (r.cat === c.id ? i : -1)).filter((i) => i >= 0);
      if (catMode[c.id] === 'oculto') { catMode[c.id] = 'solido'; syncLayers(); }
      selected = { key: 'cat:' + c.id, list }; refreshState();
      showInfoCat(c, list); flyTo(boxOf(list), { pad: 1.05 });
    };
    row.querySelectorAll('.seg button').forEach((b) => b.onclick = () => { catMode[c.id] = b.dataset.m; syncLayers(); refreshState(); });
    row.dataset.cat = c.id; box.appendChild(row);
  }
  syncLayers();
}
function syncLayers() {
  document.querySelectorAll('.layer').forEach((row) => {
    row.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === catMode[row.dataset.cat]));
    row.classList.toggle('off', catMode[row.dataset.cat] === 'oculto');
  });
}
function showInfoCat(c, list) {
  ui.infoName.textContent = c.pt; ui.infoLat.hidden = true; ui.infoEn.textContent = '';
  const s = boxOf(list).getSize(new THREE.Vector3());
  ui.infoMeta.innerHTML = `<div><dt>Camada</dt><dd>${list.length} estruturas</dd></div><div><dt>Tamanho no modelo</dt><dd>${fmtCm(s.x)} × ${fmtCm(s.y)} × ${fmtCm(s.z)} cm</dd></div>`;
  ui.infoNote.hidden = true; ui.infoPath.hidden = true;
  // mostra os grupos de topo desta camada
  const tops = new Map();
  for (const i of list) { const r = ROWS[i]; const k = r.path[Math.min(2, r.path.length - 1)] || r.id; tops.set(k, (tops.get(k) || 0) + 1); }
  ui.infoKids.innerHTML = '<div class="kids-h">Partes</div>';
  [...tops.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'pt')).forEach((k) => {
    const b = document.createElement('button'); b.className = 'kid';
    b.innerHTML = `<i style="background:${ROWS[membersOf(k)[0]].color}"></i><span>${nameOf(k)}</span>`;
    b.onclick = () => select(k); ui.infoKids.appendChild(b);
  });
  ui.info.classList.add('open');
}

// ---------- Busca ----------
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchIndex = [];
for (const [k, g] of Object.entries(GROUPS)) if (membersOf(k).length) searchIndex.push({ key: k, pt: g.pt, sub: g.la || g.en, hay: norm(`${g.pt} ${g.en} ${g.la || ''}`), group: true });
const seenBase = new Set();
ROWS.forEach((r) => {
  searchIndex.push({ key: r.id, pt: r.pt, sub: r.la || r.en, side: r.side, hay: norm(`${r.pt} ${r.en} ${r.la || ''}`), color: r.color });
});
function runSearch(q) {
  const out = $('#results'); out.innerHTML = '';
  const nq = norm(q).trim(); if (!nq) { out.hidden = true; return; }
  const words = nq.split(/\s+/);
  const hits = searchIndex.filter((e) => words.every((w) => e.hay.includes(w)))
    .map((e) => ({ e, score: (norm(e.pt).startsWith(nq) ? 0 : 1) + (e.group ? 0 : 0.5) + e.pt.length / 200 }))
    .sort((a, b) => a.score - b.score).slice(0, 30);
  if (!hits.length) { out.innerHTML = '<div class="empty">Nada com esse nome. Tente em português, latim ou inglês.</div>'; out.hidden = false; return; }
  for (const { e } of hits) {
    const b = document.createElement('button'); b.className = 'res';
    const col = e.color || ROWS[membersOf(e.key)[0]].color;
    b.innerHTML = `<i style="background:${col}"></i><span><b>${e.pt}${e.side ? ` <em>${SIDE_PT[e.side]}</em>` : ''}</b><small>${e.group ? 'Grupo · ' : ''}${e.sub || ''}</small></span>`;
    b.onclick = () => { closeSearch(); revealFor(e.key); select(e.key); };
    out.appendChild(b);
  }
  out.hidden = false;
}
// se a estrutura buscada estiver numa camada oculta, a camada volta
function revealFor(key) {
  let changed = false;
  for (const i of membersOf(key)) { const c = ROWS[i].cat; if (catMode[c] === 'oculto') { catMode[c] = 'solido'; changed = true; } hidden.delete(i); }
  if (isolated && !membersOf(key).every((i) => isolated.has(i))) isolated = null;
  if (changed) syncLayers();
}
function closeSearch() { $('#q').value = ''; $('#results').hidden = true; document.body.classList.remove('searching'); $('#q').blur(); }

// ---------- Roteiros ----------
function setModes(m) { for (const c of CATS) catMode[c.id] = m[c.id] || 'oculto'; syncLayers(); }
const ALL_SOLID = Object.fromEntries(CATS.map((c) => [c.id, 'solido']));
const TOURS = [
  { id: 'corpo', pt: 'Corpo inteiro', sub: 'Central e periférico',
    run() { setModes({ ...ALL_SOLID, meninges: 'oculto', branca: 'oculto' }); ghost(true, true); setClip('nenhum');
      flyTo(boxOf(ROWS.map((_, i) => i)), { dir: DIR.tres4, pad: 1.0 }); } },
  { id: 'encefalo', pt: 'Encéfalo', sub: 'Lobos e giros',
    run() { setModes({ ...ALL_SOLID, meninges: 'oculto', branca: 'oculto' }); ghost(true, false); setClip('nenhum');
      flyTo(boxOf(membersOf('brain')), { dir: new THREE.Vector3(1, 0.35, 0.55), pad: 1.05 }); } },
  { id: 'profundo', pt: 'Por dentro', sub: 'Córtex de vidro',
    run() { setModes({ ...ALL_SOLID, cortex: 'vidro', branca: 'oculto', meninges: 'oculto', sentidos: 'vidro' }); ghost(false, false); setClip('nenhum');
      flyTo(boxOf(membersOf('cerebrum')), { dir: new THREE.Vector3(0.9, 0.45, 0.75), pad: 1.0 }); } },
  { id: 'sagital', pt: 'Corte sagital', sub: 'Face medial',
    run() { setModes({ ...ALL_SOLID, meninges: 'oculto' }); ghost(false, false);
      clipBox = boxOf(membersOf('brain')); setClip('sagital', 0.5);
      flyTo(boxOf(membersOf('brain')), { dir: new THREE.Vector3(1, 0.05, 0.02), pad: 1.0 }); } },
  { id: 'cranianos', pt: 'Nervos cranianos', sub: 'I a XII na base',
    run() { setModes({ ...ALL_SOLID, cortex: 'oculto', branca: 'oculto', nucleos: 'solido', ventriculos: 'oculto', meninges: 'oculto', sentidos: 'vidro', cerebelo: 'vidro', espinais: 'vidro' }); ghost(false, false); setClip('nenhum');
      const head = boxOf(membersOf('brain')); const b = boxOf(membersOf('brainstem')).union(boxOf(membersOf('cranial_nerves')).intersect(head.clone().expandByScalar(0.01)));
      flyTo(b, { dir: new THREE.Vector3(0.3, -0.4, 1), pad: 1.0 }); } },
  { id: 'medula', pt: 'Medula e tratos', sub: 'Corte transversal',
    run() { setModes({ ...ALL_SOLID, meninges: 'oculto', branca: 'oculto', espinais: 'vidro', autonomo: 'vidro', cranianos: 'vidro' }); ghost(false, false);
      const b = boxOf(membersOf('spinal_cord')); clipBox = b; setClip('axial', 0.8);
      const y = THREE.MathUtils.lerp(b.min.y, b.max.y, 0.8);
      const cb = boxOf(membersOf('white_matter_of_spinal_cord')); const c = cb.getCenter(new THREE.Vector3());
      const fb = new THREE.Box3(new THREE.Vector3(c.x - 0.02, y - 0.012, c.z - 0.02), new THREE.Vector3(c.x + 0.02, y, c.z + 0.02));
      for (const i of membersOf('white_matter_of_spinal_cord_2')) hidden.add(i);
      flyTo(fb, { dir: new THREE.Vector3(0.35, 1.2, 0.8), pad: 1.0 }); } },
  { id: 'braquial', pt: 'Plexo braquial', sub: 'Braço e mão',
    run() { setModes({ ...ALL_SOLID, meninges: 'oculto', branca: 'oculto' }); ghost(true, true); setClip('nenhum');
      const l = membersOf('brachial_plexus').filter((i) => ROWS[i].side === 'right');
      flyTo(boxOf(l), { dir: new THREE.Vector3(-0.3, 0.15, 1), pad: 1.05 }); } },
  { id: 'lombossacral', pt: 'Plexo lombossacral', sub: 'Pelve e perna',
    run() { setModes({ ...ALL_SOLID, meninges: 'oculto', branca: 'oculto' }); ghost(true, true); setClip('nenhum');
      flyTo(boxOf(membersOf('lumbosacral_plexus')), { dir: new THREE.Vector3(0.5, 0.15, 1), pad: 0.95 }); } },
  { id: 'autonomo', pt: 'Autônomo', sub: 'Tronco simpático',
    run() { setModes({ ...ALL_SOLID, espinais: 'vidro', cranianos: 'vidro', meninges: 'oculto', branca: 'oculto' }); ghost(true, true); setClip('nenhum');
      flyTo(boxOf(membersOf('autonomic_division_of_peripheral_nervous_system')), { dir: new THREE.Vector3(0.9, 0.1, 0.6), pad: 1.05 }); } },
];
function runTour(id) {
  const t = TOURS.find((x) => x.id === id); if (!t) return;
  hidden.clear(); isolated = null; selected = null; ui.info.classList.remove('open'); ui.label.classList.remove('on');
  clipBox = null;
  t.run(); refreshState(); setHash('');
  document.querySelectorAll('.tour').forEach((b) => b.classList.toggle('on', b.dataset.t === id));
  currentTour = id;
}
let currentTour = 'corpo';
function buildTours() {
  const box = $('#tours');
  for (const t of TOURS) {
    const b = document.createElement('button'); b.className = 'tour'; b.dataset.t = t.id;
    b.innerHTML = `<b>${t.pt}</b><small>${t.sub}</small>`;
    b.onclick = () => { runTour(t.id); if (isTouch) closeSheets(); };
    box.appendChild(b);
  }
}

function ghost(skin, bone) { ghostSkin = skin; ghostBone = bone; syncGhost(); }
function syncGhost() {
  if (skinMesh) skinMesh.visible = ghostSkin; if (boneMesh) boneMesh.visible = ghostBone;
  $('#t-skin').classList.toggle('on', ghostSkin); $('#t-bone').classList.toggle('on', ghostBone); needsRender = true;
}
function setClip(axis, t) {
  clip.axis = axis; if (t !== undefined) clip.t = t;
  document.querySelectorAll('.clip-ax').forEach((b) => b.classList.toggle('on', b.dataset.a === axis));
  $('#clip-range').disabled = axis === 'nenhum'; $('#clip-range').value = Math.round(clip.t * 1000);
  applyClip();
}

// ---------- Endereço (link direto para uma estrutura) ----------
function setHash(k) { try { history.replaceState(null, '', k ? '#' + k.replace(/_/g, '-') : location.pathname + location.search); } catch (e) { /* página sem endereço próprio */ } }

// ---------- Montagem ----------
let nervMesh, glassMesh, skinMesh, boneMesh;
let needsRender = true;

async function init() {
  for (const c of CATS) catMode[c.id] = 'solido';
  catMode.meninges = 'oculto'; catMode.branca = 'oculto';
  const bar = $('#load-bar');
  const geos = await loadGeometry((p) => { bar.style.transform = `scaleX(${p})`; });
  const nerv = geos.nervous;
  nervMesh = new THREE.Mesh(nerv.g, makeNervousMaterial('solid'));
  glassMesh = new THREE.Mesh(nerv.g, makeNervousMaterial('glass')); glassMesh.renderOrder = 2;
  skinMesh = new THREE.Mesh(geos.skin.g, makeGhostMaterial('#6F9BFF', 0.55, 0.004)); skinMesh.renderOrder = 3;
  boneMesh = new THREE.Mesh(geos.bone.g, makeGhostMaterial('#B9C6D6', 0.42, 0.012)); boneMesh.renderOrder = 1;
  for (const m of [nervMesh, glassMesh, skinMesh, boneMesh]) { placeQuantized(m); m.frustumCulled = false; scene.add(m); }
  pickMesh = new THREE.Mesh(nerv.g, pickMat); placeQuantized(pickMesh); pickMesh.frustumCulled = false; pickScene.add(pickMesh);
  computeBoxes(nerv);
  bar.style.transform = 'scaleX(1)';

  buildLayers(); buildTours(); wireUI(); resize();
  const all = boxOf(ROWS.map((_, i) => i));
  // posição inicial
  const startKey = decodeURIComponent((location.hash || '').slice(1)).replace(/-/g, '_');
  runTour('corpo');
  anim = null; flyTo(all, { dir: DIR.tres4, pad: 1.0, dur: 0 }); stepAnim(performance.now());
  if (startKey && membersOf(startKey).length) { revealFor(startKey); select(startKey); }
  $('#stats').textContent = `${N} estruturas · ${(META.geo.layers.nervous.ic / 3 / 1000).toFixed(0)} mil triângulos`;
  document.body.classList.add('ready');
  if (!reduceMotion && !startKey && !/nospin/.test(location.search)) { autoSpin = true; }
  window.__mielina = { runTour, select, setClip, clearSelection };
  requestAnimationFrame(loop);
}

let autoSpin = false;
function stopSpin() { autoSpin = false; }

// ---------- Eventos ----------
function wireUI() {
  window.addEventListener('resize', resize);
  controls.addEventListener('start', () => { anim = null; stopSpin(); });
  controls.addEventListener('change', () => { needsRender = true; });

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; stopSpin(); });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 6 && performance.now() - down.t < 600) {
      const r = canvas.getBoundingClientRect();
      const id = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (id >= 0) { select(ROWS[id].id, { fly: !!e.detail && e.detail > 1 }); }
      else if (selected) clearSelection();
    }
    down = null;
  });
  canvas.addEventListener('dblclick', (e) => {
    const r = canvas.getBoundingClientRect(); const id = pickAt(e.clientX - r.left, e.clientY - r.top);
    if (id >= 0) select(ROWS[id].id);
  });
  if (!isTouch) {
    let last = 0;
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons) { ui.tip.classList.remove('on'); return; }
      const now = performance.now(); if (now - last < 60) return; last = now;
      const r = canvas.getBoundingClientRect(); const id = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (id !== hovered) { hovered = id; if (!hoverSet) hoverList(null); }
      if (id >= 0) {
        ui.tip.innerHTML = `${ROWS[id].pt}${ROWS[id].side ? ` <em>${SIDE_PT[ROWS[id].side]}</em>` : ''}`;
        ui.tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`; ui.tip.classList.add('on');
        canvas.style.cursor = 'pointer';
      } else { ui.tip.classList.remove('on'); canvas.style.cursor = ''; }
    });
    canvas.addEventListener('pointerleave', () => { hovered = -1; hoverList(null); ui.tip.classList.remove('on'); });
  }

  $('#info-close').onclick = clearSelection;
  $('#b-focus').onclick = () => { if (selected) flyTo(boxOf(selected.list), { pad: selected.list.length > 1 ? 1.2 : 1.8 }); };
  $('#b-isolate').onclick = () => {
    if (!selected) return;
    if (isolated && selected.list.every((i) => isolated.has(i)) && isolated.size === selected.list.length) { isolated = null; }
    else { isolated = new Set(selected.list); for (const i of selected.list) hidden.delete(i); }
    refreshState(); syncActions();
  };
  $('#b-hide').onclick = () => {
    if (!selected) return; for (const i of selected.list) hidden.add(i);
    selected = null; ui.info.classList.remove('open'); ui.label.classList.remove('on'); refreshState(); syncActions();
  };
  $('#b-showall').onclick = () => { hidden.clear(); isolated = null; refreshState(); syncActions(); };
  $('#b-reset').onclick = () => runTour(currentTour);
  $('#t-skin').onclick = () => { ghostSkin = !ghostSkin; syncGhost(); };
  $('#t-bone').onclick = () => { ghostBone = !ghostBone; syncGhost(); };
  document.querySelectorAll('.clip-ax').forEach((b) => b.onclick = () => {
    if (b.dataset.a !== 'nenhum' && clip.axis === 'nenhum') { clipBox = selected ? boxOf(selected.list) : null; clip.t = 0.5; }
    setClip(b.dataset.a);
  });
  $('#clip-range').oninput = (e) => { clip.t = e.target.value / 1000; applyClip(); };
  const q = $('#q');
  q.addEventListener('input', () => runSearch(q.value));
  q.addEventListener('focus', () => { document.body.classList.add('searching'); if (q.value) runSearch(q.value); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    if (e.key === 'Enter') { const f = $('#results .res'); if (f) f.click(); }
  });
  $('#b-search').onclick = () => { document.body.classList.add('searching'); q.focus(); };
  $('#search-cancel').onclick = closeSearch;
  document.addEventListener('keydown', (e) => {
    if (e.target === q) return;
    if (e.key === '/' ) { e.preventDefault(); $('#b-search').click(); }
    if (e.key === 'Escape') { clearSelection(); }
  });
  // folhas no celular
  $('#b-layers').onclick = () => toggleSheet('panel-layers');
  $('#b-tools').onclick = () => toggleSheet('panel-tools');
  $('#b-about').onclick = () => $('#about').showModal();
  $('#about-close').onclick = () => $('#about').close();
  $('#b-dim').onclick = () => { dimOthers = !dimOthers; $('#b-dim').classList.toggle('on', dimOthers); refreshState(); };
  $('#b-dim').classList.toggle('on', dimOthers);
}
function syncActions() {
  $('#b-showall').hidden = !(hidden.size || isolated);
  $('#b-isolate').classList.toggle('on', !!isolated);
}
function toggleSheet(id) {
  const el = document.getElementById(id); const open = !el.classList.contains('open');
  closeSheets(); if (open) el.classList.add('open');
  document.querySelectorAll('.dock button[data-sheet]').forEach((b) => b.classList.toggle('on', b.dataset.sheet === id && open));
}
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open')); document.querySelectorAll('.dock button[data-sheet]').forEach((b) => b.classList.remove('on')); }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h; const fa = freeArea(); view.x = fa.x; view.y = fa.y; applyView(); camera.updateProjectionMatrix(); needsRender = true;
}

// rótulo flutuante da estrutura selecionada
const tmpV = new THREE.Vector3();
function updateLabel() {
  if (!selected || ui.info.classList.contains('open') && isTouch) { ui.label.classList.remove('on'); return; }
  const b = boxOf(selected.list); b.getCenter(tmpV);
  tmpV.project(camera);
  if (tmpV.z > 1) { ui.label.classList.remove('on'); return; }
  const x = (tmpV.x * 0.5 + 0.5) * window.innerWidth, y = (-tmpV.y * 0.5 + 0.5) * window.innerHeight;
  ui.label.textContent = nameOf(selected.key.startsWith('cat:') ? '' : selected.key) || '';
  ui.label.style.transform = `translate(${x}px, ${y}px)`;
  ui.label.classList.toggle('on', !!ui.label.textContent && !isTouch);
}

let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  shared.uTime.value = now / 1000;
  stepAnim(now);
  { const fa = freeArea(); const k = 1 - Math.pow(0.0015, dt);
    if (Math.abs(fa.x - view.x) > 0.3 || Math.abs(fa.y - view.y) > 0.3) { view.x += (fa.x - view.x) * k; view.y += (fa.y - view.y) * k; applyView(); needsRender = true; } }
  if (autoSpin) {
    const off = camera.position.clone().sub(controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.12); camera.position.copy(controls.target).add(off); needsRender = true;
  }
  const changed = controls.update();
  key.position.set(0.6, 1.2, 1.4).applyQuaternion(camera.quaternion).add(camera.position);
  key.target.position.copy(controls.target); rim.target.position.copy(controls.target);
  rim.position.set(-1.2, 0.6, -1.4).applyQuaternion(camera.quaternion).add(controls.target);
  if (selected) needsRender = true; // pulso do destaque
  if (needsRender || anim || changed) {
    composer.render(); updateLabel(); needsRender = false;
  }
}

init().catch((e) => { console.error(e); $('#load-msg').textContent = 'Não foi possível abrir o modelo neste navegador: ' + e.message; });
