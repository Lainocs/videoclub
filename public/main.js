import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Dimensions en metres (boitier DVD reel : 135 x 190 x 14 mm)
// ---------------------------------------------------------------------------
const CASE = { w: 0.135, h: 0.19, t: 0.015 };
const ROWS = 4;
const ROW_PITCH = 0.245;
const COL_PITCH = 0.158;
const BASE_Y = 0.62; // dessus du meuble bas = premier rayon
const LEAN = 0.09; // inclinaison des boitiers contre le fond
const SHELF_DEPTH = 0.095;
const SHELF_T = 0.02;
const CASE_FRONT_Z = 0.066;
const CANOPY_BOTTOM = BASE_Y + ROWS * ROW_PITCH - 0.03;
const CAM = { y: 1.3, z: 2.3, lookY: 1.22, fov: 36 };
const ACCENT = '#ff4a1c';
const INK = '#f2ede4';
const LACQUER = 0xb4aea4;

const $ = (id) => document.getElementById(id);
const damp = THREE.MathUtils.damp;
const clamp = THREE.MathUtils.clamp;
const isNarrow = () => window.innerWidth <= 760;

// ---------------------------------------------------------------------------
// Renderer, scene, camera, post
// ---------------------------------------------------------------------------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0a09);
scene.fog = new THREE.Fog(0x0b0a09, 3.2, 8);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, 0.05, 30);
scene.add(camera);

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.22, 0.5, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.4 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 c = vUv - 0.5;
      vec2 off = c * dot(c, c) * 0.012;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv - off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv + off).b
      );
      float v = smoothstep(0.95, 0.2, length(c * vec2(1.0, 0.8)));
      col *= mix(1.0, v, uVignette);
      // grain a 24 i/s, plus discret dans les noirs (sinon ca fourmille)
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float frame = floor(uTime * 24.0);
      col += (hash(floor(vUv * uRes) + mod(frame, 64.0) * 17.0) - 0.5) * 0.028 * (0.25 + 0.75 * smoothstep(0.0, 0.35, luma));
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finish);

// ---------------------------------------------------------------------------
// Lumieres
// ---------------------------------------------------------------------------
RectAreaLightUniformsLib.init();
const hemi = new THREE.HemisphereLight(0xfff1e0, 0x15110d, 0.35);
scene.add(hemi);

const rowLights = [];
const signMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const SIGN_COLOR = new THREE.Color(1.05, 1.0, 0.95);
const ROW_LIGHT_INTENSITY = 5;

// Lumiere de presentation : suit la camera, s'allume quand un film est sorti
const focusLight = new THREE.SpotLight(0xfff3e4, 0, 0, 0.55, 0.7, 2);
focusLight.position.set(-0.35, 0.3, 0.1);
focusLight.target.position.set(-0.05, -0.02, -0.45);
camera.add(focusLight, focusLight.target);
const rimLight = new THREE.PointLight(0xffb48a, 0, 0, 2);
rimLight.position.set(0.3, 0.12, -0.7);
camera.add(rimLight);

// ---------------------------------------------------------------------------
// Materiaux partages
// ---------------------------------------------------------------------------
const M = {
  backPanel: new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 0.85, envMapIntensity: 0.2 }),
  room: new THREE.MeshStandardMaterial({ color: 0x100f0e, roughness: 1, envMapIntensity: 0.1 }),
  lacquer: new THREE.MeshStandardMaterial({ color: LACQUER, roughness: 0.4, envMapIntensity: 0.3 }),
  cabinet: new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.6, envMapIntensity: 0.25 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x151311, roughness: 0.5, envMapIntensity: 0.25 }),
  plastic: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, roughness: 0.32, clearcoat: 0.6, envMapIntensity: 0.7 }),
  strip: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.92, 0.8).multiplyScalar(2.2) }),
};

// ---------------------------------------------------------------------------
// Helpers canvas
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    lines[maxLines - 1] = fitText(ctx, `${lines[maxLines - 1]} …`, maxWidth).replace(/\s…$/, '…');
  }
  return lines;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sortKey = (title) => norm(title).replace(/^(the|an?|les?|la|l'|une?)\s*(?=\S)/, '').replace(/^[^a-z0-9]+/, '');
const letterOf = (title) => {
  const ch = sortKey(title).charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
};
const pad = (n) => String(n).padStart(3, '0');
const fmtRuntime = (m) => (m ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : null);
const fmtRating = (r) => (r ? `${r.toFixed(1).replace('.', ',')} / 10` : null);

// ---------------------------------------------------------------------------
// Textures procedurales
// ---------------------------------------------------------------------------
function shadowTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    const inset = 4 + i * 1.6;
    ctx.beginPath();
    ctx.roundRect(inset, inset, 128 - inset * 2, 128 - inset * 2, 18);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
const SHADOW_TEX = shadowTexture();

function spineTexture(film) {
  const W = 48;
  const H = 736;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#121110';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, 0);
  ctx.rotate(Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.font = '600 21px Inter';
  ctx.fillText(fitText(ctx, film.title.toUpperCase(), H - 150), 34, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = ACCENT;
  ctx.font = '500 16px "JetBrains Mono"';
  ctx.fillText(film.year || '', H - 34, 0);
  ctx.restore();
  return canvasTexture(c);
}

function fallbackCover(film) {
  const [c, ctx] = makeCanvas(342, 481);
  ctx.fillStyle = '#1a1816';
  ctx.fillRect(0, 0, 342, 481);
  ctx.fillStyle = INK;
  ctx.font = '400 44px "Instrument Serif"';
  wrapLines(ctx, film.title, 290, 5).forEach((l, i) => ctx.fillText(l, 26, 80 + i * 46));
  ctx.fillStyle = ACCENT;
  ctx.font = '500 14px "JetBrains Mono"';
  ctx.fillText(film.year || '', 26, 450);
  return canvasTexture(c);
}

function backTexture(film, index, total) {
  const W = 675;
  const H = 950;
  const P = 46;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#141311';
  ctx.fillRect(0, 0, W, H);
  const rand = seeded(index * 7919 + 13);

  // grain papier
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.025})`;
    ctx.fillRect(rand() * W, rand() * H, 1, 1);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 14px "JetBrains Mono"';
  ctx.fillStyle = ACCENT;
  ctx.fillText('VIDEOCLUB — LOCATION 48H', P, P + 10);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(242,237,228,0.45)';
  ctx.fillText(`N° ${pad(index + 1)} / ${total}`, W - P, P + 10);
  ctx.textAlign = 'left';

  let y = P + 86;
  ctx.fillStyle = INK;
  ctx.font = '400 62px "Instrument Serif"';
  for (const line of wrapLines(ctx, film.title, W - P * 2, 3)) {
    ctx.fillText(line, P, y);
    y += 60;
  }
  if (film.director) {
    ctx.font = 'italic 400 26px "Instrument Serif"';
    ctx.fillStyle = 'rgba(242,237,228,0.65)';
    ctx.fillText(`Un film de ${film.director}`, P, y + 2);
    y += 34;
  }

  y += 18;
  ctx.fillStyle = 'rgba(242,237,228,0.14)';
  ctx.fillRect(P, y, W - P * 2, 1);
  y += 40;

  ctx.font = '400 19px Inter';
  ctx.fillStyle = 'rgba(242,237,228,0.78)';
  const overview = film.overview || 'Pas de synopsis disponible.';
  const maxLines = Math.max(4, Math.floor((H - 330 - y) / 29));
  for (const line of wrapLines(ctx, overview, W - P * 2, maxLines)) {
    ctx.fillText(line, P, y);
    y += 29;
  }

  // Fiche technique
  const factsY = H - 270;
  ctx.fillStyle = 'rgba(242,237,228,0.14)';
  ctx.fillRect(P, factsY - 30, W - P * 2, 1);
  const facts = [
    ['ANNÉE', film.year || '—'],
    ['DURÉE', fmtRuntime(film.runtime) || '—'],
    ['NOTE', film.rating ? film.rating.toFixed(1).replace('.', ',') : '—'],
  ];
  const colW = (W - P * 2) / 3;
  facts.forEach(([k, v], i) => {
    ctx.font = '500 12px "JetBrains Mono"';
    ctx.fillStyle = 'rgba(242,237,228,0.4)';
    ctx.fillText(k, P + i * colW, factsY);
    ctx.font = '400 34px "Instrument Serif"';
    ctx.fillStyle = INK;
    ctx.fillText(v, P + i * colW, factsY + 40);
  });
  if (film.genres?.length) {
    ctx.font = '500 13px "JetBrains Mono"';
    ctx.fillStyle = 'rgba(242,237,228,0.5)';
    ctx.fillText(fitText(ctx, film.genres.join(' · ').toUpperCase(), W - P * 2), P, factsY + 82);
  }

  // Code-barres
  const bx = P;
  const by = H - P - 92;
  ctx.fillStyle = '#efe9df';
  ctx.fillRect(bx, by, 190, 92);
  ctx.fillStyle = '#111';
  let x = bx + 12;
  while (x < bx + 178) {
    const w = 1 + Math.floor(rand() * 3);
    if (rand() > 0.38) ctx.fillRect(x, by + 10, w, 58);
    x += w + 1;
  }
  ctx.font = '500 12px "JetBrains Mono"';
  ctx.fillText(`3 ${String(Math.floor(rand() * 1e6)).padStart(6, '0')} ${String(Math.floor(rand() * 1e6)).padStart(6, '0')}`, bx + 14, by + 84);

  // Pastille de location
  ctx.save();
  ctx.translate(W - P - 66, H - P - 62);
  ctx.rotate(-0.22);
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(0, 0, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#160904';
  ctx.textAlign = 'center';
  ctx.font = '400 48px "Instrument Serif"';
  ctx.fillText('48h', 0, 8);
  ctx.font = '500 13px "JetBrains Mono"';
  ctx.fillText('2,50 €', 0, 32);
  ctx.restore();

  return canvasTexture(c);
}

// ---------------------------------------------------------------------------
// Etat
// ---------------------------------------------------------------------------
const state = {
  camX: 0,
  camXTarget: 0,
  camVel: 0,
  minX: 0,
  maxX: 0,
  firstX: 0,
  lastX: 0,
  introT: -1,
  focus: null,
  focusAmt: 0,
  hovered: null,
  cursor: -1,
  yaw: 0,
  yawGoal: 0,
  yawVel: 0,
  pitch: 0,
  forceFront: false,
  px: 0,
  py: 0,
};
let entries = [];
let letters = [];
let pickables = [];

const pointer = { x: 0, y: 0, nx: 0, ny: 0, inside: false, down: false, dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0, lastT: 0 };
const raycaster = new THREE.Raycaster();
const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);
texLoader.setCrossOrigin('anonymous');

// ---------------------------------------------------------------------------
// Construction du magasin
// ---------------------------------------------------------------------------
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}

function buildStore(sorted) {
  const cols = Math.max(8, Math.ceil(sorted.length / ROWS));
  const wallW = cols * COL_PITCH + 0.16;
  const colX = (c) => c * COL_PITCH - ((cols - 1) * COL_PITCH) / 2;
  state.firstX = colX(0);
  state.lastX = colX(Math.ceil(sorted.length / ROWS) - 1);

  // Piece + sol
  const room = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), M.room);
  room.position.set(0, 4, -0.01);
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 5;
  scene.add(floor);

  // Meuble
  const backH = CANOPY_BOTTOM - BASE_Y + 0.05;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(wallW, backH), M.backPanel);
  back.position.set(0, BASE_Y + backH / 2 - 0.02, 0.001);
  scene.add(back);
  // meuble bas : caisson sous la planche (aucune face confondue, sinon z-fighting)
  const cabH = BASE_Y - 0.012;
  box(wallW + 0.04, cabH, 0.19, M.cabinet, 0, cabH / 2, 0.095);
  box(wallW + 0.05, 0.012, 0.2, M.lacquer, 0, BASE_Y - 0.006, 0.1);
  box(wallW + 0.03, 0.06, 0.006, M.backPanel, 0, 0.03, 0.193); // plinthe

  for (let k = 1; k < ROWS; k++) {
    box(wallW, SHELF_T, SHELF_DEPTH, M.lacquer, 0, BASE_Y + k * ROW_PITCH - SHELF_T / 2, SHELF_DEPTH / 2);
  }
  for (let k = 1; k < ROWS; k++) {
    box(wallW, 0.016, 0.005, M.lacquer, 0, BASE_Y + (k - 1) * ROW_PITCH + 0.008, SHELF_DEPTH - 0.0025);
  }

  const canopyH = 0.09;
  box(wallW + 0.05, canopyH, 0.16, M.cabinet, 0, CANOPY_BOTTOM + canopyH / 2, 0.08);
  const sideH = CANOPY_BOTTOM + canopyH + 0.28;
  [-1, 1].forEach((s) => box(0.025, sideH, 0.2, M.lacquer, s * (wallW / 2 + 0.0375), sideH / 2, 0.1));

  // Bandeau avec les lettres de l'index
  const bandW = wallW + 0.05;
  const ppm = Math.min(820, 8000 / bandW);
  const [bc, bctx] = makeCanvas(Math.round(bandW * ppm), Math.round(canopyH * ppm));
  bctx.fillStyle = '#1d1b19';
  bctx.fillRect(0, 0, bc.width, bc.height);
  bctx.textBaseline = 'middle';
  let lastLabelX = -Infinity;
  letters.forEach((l) => {
    const x = Math.max((colX(Math.floor(l.first / ROWS)) - CASE.w / 2 + bandW / 2) * ppm, lastLabelX + bc.height * 0.55);
    lastLabelX = x;
    bctx.fillStyle = 'rgba(242,237,228,0.18)';
    bctx.fillRect(x, bc.height * 0.3, 1.5, bc.height * 0.4);
    bctx.fillStyle = INK;
    bctx.font = `500 ${Math.round(bc.height * 0.3)}px "JetBrains Mono"`;
    bctx.fillText(l.letter, x + 12, bc.height / 2 + 1);
  });
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(bandW, canopyH),
    new THREE.MeshStandardMaterial({ map: canvasTexture(bc), roughness: 0.6, envMapIntensity: 0.3 }),
  );
  band.position.set(0, CANOPY_BOTTOM + canopyH / 2, 0.1605);
  scene.add(band);

  // Enseigne lumineuse
  const signH = 0.22;
  const signY = CANOPY_BOTTOM + canopyH + 0.03 + signH / 2;
  box(wallW + 0.05, signH + 0.03, 0.05, M.cabinet, 0, signY, 0.025);
  const sppm = Math.min(900, 8000 / wallW);
  const [sc, sctx] = makeCanvas(Math.round(wallW * sppm), Math.round(signH * sppm));
  sctx.fillStyle = '#f4ede2';
  sctx.fillRect(0, 0, sc.width, sc.height);
  sctx.textBaseline = 'middle';
  const seg = 1.7 * sppm;
  const segments = Math.max(1, Math.round(sc.width / seg));
  for (let i = 0; i < segments; i++) {
    const cx = (sc.width / segments) * (i + 0.5);
    if (i % 2 === 0) {
      sctx.font = `400 ${Math.round(sc.height * 0.66)}px "Instrument Serif"`;
      sctx.textAlign = 'center';
      sctx.fillStyle = '#171513';
      const label = 'Videoclub';
      const w = sctx.measureText(label).width;
      sctx.fillText(label, cx - sc.height * 0.08, sc.height * 0.54);
      sctx.fillStyle = ACCENT;
      sctx.fillText('.', cx + w / 2 + sc.height * 0.02, sc.height * 0.54);
    } else {
      sctx.font = `500 ${Math.round(sc.height * 0.16)}px "JetBrains Mono"`;
      sctx.textAlign = 'center';
      sctx.fillStyle = '#171513';
      sctx.fillText(`LOCATION · ${sorted.length} FILMS · OUVERT LA NUIT`, cx, sc.height / 2);
    }
  }
  signMat.map = canvasTexture(sc);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(wallW, signH), signMat);
  sign.position.set(0, signY, 0.0505);
  scene.add(sign);

  // Eclairage de chaque rayon : bande LED sous l'etagere du dessus
  for (let k = 0; k < ROWS; k++) {
    const y = (k < ROWS - 1 ? BASE_Y + (k + 1) * ROW_PITCH - SHELF_T : CANOPY_BOTTOM) - 0.004;
    const z = (k < ROWS - 1 ? SHELF_DEPTH : 0.15) - 0.012;
    const light = new THREE.RectAreaLight(0xffe9cf, ROW_LIGHT_INTENSITY, wallW - 0.02, 0.014);
    light.position.set(0, y, z);
    light.lookAt(0, y - 1, -0.25);
    scene.add(light);
    rowLights.push(light);
    box(wallW - 0.02, 0.004, 0.012, M.strip, 0, y + 0.001, z);
  }

  // Boitiers
  const caseGeo = new RoundedBoxGeometry(CASE.w, CASE.h, CASE.t, 2, 0.0022);
  const coverGeo = new THREE.PlaneGeometry(CASE.w - 0.0035, CASE.h - 0.0035);
  const spineGeo = new THREE.PlaneGeometry(CASE.t - 0.003, CASE.h - 0.006);
  const shadowGeo = new THREE.PlaneGeometry(CASE.w * 1.45, CASE.h * 1.2);

  entries = sorted.map((film, i) => {
    const rand = seeded(i * 104729 + 7);
    const col = Math.floor(i / ROWS);
    const k = ROWS - 1 - (i % ROWS);
    const shelfTop = BASE_Y + k * ROW_PITCH;
    const lean = LEAN + (rand() - 0.5) * 0.03;
    const x = colX(col) + (rand() - 0.5) * 0.006;

    const homePos = new THREE.Vector3(
      x,
      shelfTop + (CASE.h / 2) * Math.cos(lean) - (CASE.t / 2) * Math.sin(lean) + 0.001,
      CASE_FRONT_Z - (CASE.h / 2) * Math.sin(lean) - (CASE.t / 2) * Math.cos(lean),
    );
    const homeRot = new THREE.Euler(-lean, (rand() - 0.5) * 0.02, (rand() - 0.5) * 0.012);

    const group = new THREE.Group();
    const body = new THREE.Mesh(caseGeo, M.plastic);
    const frontMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1a1a, roughness: 0.6, clearcoat: 0.5, clearcoatRoughness: 0.22, envMapIntensity: 0.25,
    });
    const front = new THREE.Mesh(coverGeo, frontMat);
    front.position.z = CASE.t / 2 + 0.0003;
    const backMat = new THREE.MeshPhysicalMaterial({
      color: 0x141311, roughness: 0.6, clearcoat: 1, clearcoatRoughness: 0.16, envMapIntensity: 0.6,
    });
    const back = new THREE.Mesh(coverGeo, backMat);
    back.rotation.y = Math.PI;
    back.position.z = -CASE.t / 2 - 0.0003;
    const spine = new THREE.Mesh(spineGeo, new THREE.MeshStandardMaterial({ map: spineTexture(film), roughness: 0.45 }));
    spine.rotation.y = -Math.PI / 2;
    spine.position.x = -CASE.w / 2 - 0.0003;
    group.add(body, front, back, spine);
    group.position.copy(homePos);
    group.rotation.copy(homeRot);
    scene.add(group);

    const shadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: SHADOW_TEX, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    shadow.position.set(x, shelfTop + CASE.h * 0.5, 0.003);
    scene.add(shadow);

    const entry = {
      film, index: i, group, front, frontMat, backMat, shadow,
      homePos, homeQuat: new THREE.Quaternion().setFromEuler(homeRot), homeRot, lean,
      mode: 'shelf', settled: true, pull: 0, hiRes: false, hasBack: false,
    };
    body.userData.entry = entry;
    front.userData.entry = entry;
    back.userData.entry = entry;
    pickables.push(body, front, back);

    if (film.poster) {
      texLoader.load(film.poster.replace('/w500/', '/w342/'), (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        frontMat.map = tex;
        frontMat.color.set(0xffffff);
        frontMat.needsUpdate = true;
      });
    } else {
      frontMat.map = fallbackCover(film);
      frontMat.color.set(0xffffff);
    }
    return entry;
  });

  updateRange();
}

function visibleHalfWidth(distance = CAM.z) {
  return distance * Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * camera.aspect;
}

function updateRange() {
  const half = visibleHalfWidth();
  state.minX = state.firstX + half * 0.72;
  state.maxX = state.lastX - half * 0.72;
  if (state.minX > state.maxX) state.minX = state.maxX = (state.firstX + state.lastX) / 2;
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------
async function boot() {
  const setProgress = (p, text) => {
    $('loader-fill').style.width = `${p}%`;
    if (text) $('loader-text').textContent = text;
  };

  try {
    setProgress(8, 'Récupération de la watchlist');
    const fontsReady = Promise.race([
      Promise.all([
        document.fonts.load('400 40px "Instrument Serif"'),
        document.fonts.load('italic 400 40px "Instrument Serif"'),
        document.fonts.load('400 20px Inter'),
        document.fonts.load('600 20px Inter'),
        document.fonts.load('500 14px "JetBrains Mono"'),
      ]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    const res = await fetch('/api/films');
    const data = await res.json();
    await fontsReady;

    const films = (data.films || []).slice().sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title), 'fr'));
    setProgress(30, `Mise en rayon de ${films.length} films`);

    letters = [];
    films.forEach((f, i) => {
      const l = letterOf(f.title);
      if (!letters.length || letters[letters.length - 1].letter !== l) letters.push({ letter: l, first: i });
    });

    buildStore(films);
    buildIndex();
    $('count').textContent = `${films.length} films`;

    const reveal = () => {
      if (state.introT >= 0) return;
      setProgress(100);
      state.introT = 0;
      state.camX = state.camXTarget = state.minX;
      setTimeout(() => $('loader').classList.add('done'), 250);
    };
    manager.onProgress = (_, loaded, total) => setProgress(30 + (loaded / total) * 70, `Jaquettes ${loaded} / ${total}`);
    manager.onLoad = reveal;
    setTimeout(reveal, 8000);
    if (!films.some((f) => f.poster)) reveal();
  } catch (err) {
    console.error(err);
    setProgress(0, 'Impossible de charger la watchlist');
  }
}

// ---------------------------------------------------------------------------
// Index A-Z
// ---------------------------------------------------------------------------
function letterX(l) {
  const e = entries[l.first];
  return clamp(e.homePos.x + visibleHalfWidth() * 0.55, state.minX, state.maxX);
}

function buildIndex() {
  const nav = $('index');
  nav.innerHTML = '';
  letters.forEach((l) => {
    const b = document.createElement('button');
    b.textContent = l.letter;
    b.addEventListener('click', () => {
      state.camXTarget = letterX(l);
      state.camVel = 0;
    });
    l.el = b;
    nav.appendChild(b);
  });
}

let activeLetter = null;
function updateIndex() {
  if (!letters.length) return;
  // lettre de la colonne situee au premier tiers de l'ecran
  const probe = state.camX <= state.minX + 0.01 ? -Infinity : state.camX - visibleHalfWidth() * 0.45;
  let current = letters[0];
  for (const l of letters) if (entries[l.first].homePos.x <= probe + COL_PITCH * 0.5) current = l;
  if (current !== activeLetter) {
    activeLetter?.el.classList.remove('active');
    current.el.classList.add('active');
    current.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    activeLetter = current;
  }
}

// ---------------------------------------------------------------------------
// Survol / selection
// ---------------------------------------------------------------------------
function setHovered(entry) {
  if (state.hovered === entry) return;
  state.hovered = entry;
  const el = $('hover');
  if (entry && !state.focus) {
    $('hover-title').textContent = entry.film.title;
    $('hover-meta').textContent = [entry.film.year, entry.film.director].filter(Boolean).join(' · ');
    el.classList.add('on');
  } else {
    el.classList.remove('on');
  }
  canvas.style.cursor = entry ? 'pointer' : 'default';
}

function pick() {
  raycaster.setFromCamera({ x: pointer.nx, y: pointer.ny }, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  return hit ? hit.object.userData.entry : null;
}

function select(entry, { spin = false } = {}) {
  if (state.focus === entry) return;
  if (state.focus) state.focus.mode = 'shelf';
  state.focus = entry;
  state.cursor = entry.index;
  entry.mode = 'staged';
  entry.settled = false;
  state.yaw = spin ? -0.6 : 0.35;
  state.yawGoal = 0;
  state.yawVel = spin ? 16 : 0;
  state.forceFront = spin;
  state.pitch = 0.25;
  state.camXTarget = clamp(entry.homePos.x, state.minX, state.maxX);
  state.camVel = 0;

  if (!entry.hasBack) {
    entry.backMat.map = backTexture(entry.film, entry.index, entries.length);
    entry.backMat.color.set(0xffffff);
    entry.backMat.needsUpdate = true;
    entry.hasBack = true;
  }
  if (!entry.hiRes && entry.film.poster) {
    entry.hiRes = true;
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(entry.film.poster.replace('/w500/', '/w780/'), (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      entry.frontMat.map?.dispose();
      entry.frontMat.map = tex;
      entry.frontMat.needsUpdate = true;
    });
  }

  fillSheet(entry);
  setHovered(null);
  document.body.classList.add('focused');
}

function putBack() {
  if (!state.focus) return;
  state.focus.mode = 'shelf';
  state.focus = null;
  document.body.classList.remove('focused');
}

function flip() {
  if (!state.focus) return;
  state.forceFront = false;
  state.yawVel = 0;
  state.yawGoal = Math.round(state.yaw / Math.PI) * Math.PI + Math.PI;
}

function play() {
  const id = state.focus?.film.imdbId;
  if (!id) return;
  // 3 slashs (host vide) : sinon Stremio prend "detail" pour un addon
  window.location.href = `stremio:///detail/movie/${id}/${id}`;
}

function step(dir) {
  if (!entries.length) return;
  const from = state.focus ? state.focus.index : state.cursor;
  const next = entries[(from + dir + entries.length) % entries.length];
  select(next);
}

function travelThenSelect(entry, opts) {
  putBack();
  state.camXTarget = clamp(entry.homePos.x, state.minX, state.maxX);
  state.camVel = 0;
  const distance = Math.abs(state.camX - state.camXTarget);
  setTimeout(() => select(entry, opts), Math.min(900, 250 + distance * 320));
}

function random() {
  if (!entries.length) return;
  let e;
  do e = entries[Math.floor(Math.random() * entries.length)];
  while (entries.length > 1 && e === state.focus);
  travelThenSelect(e, { spin: true });
}

function fillSheet(entry) {
  const f = entry.film;
  $('sheet-kicker').textContent = [`N° ${pad(entry.index + 1)} / ${entries.length}`, ...(f.genres || []).slice(0, 2)].join(' — ');
  $('sheet-title').textContent = f.title;
  $('sheet-original').textContent = f.originalTitle && norm(f.originalTitle) !== norm(f.title) ? f.originalTitle : '';
  const facts = [
    ['Réalisation', f.director],
    ['Avec', f.cast?.length ? f.cast.join(', ') : null],
    ['Année', f.year],
    ['Durée', fmtRuntime(f.runtime)],
    ['Note TMDb', fmtRating(f.rating)],
  ].filter(([, v]) => v);
  const dl = $('sheet-facts');
  dl.innerHTML = '';
  facts.forEach(([k, v]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  });
  $('sheet-overview').textContent = f.overview || 'Pas de synopsis disponible.';
  $('btn-play').disabled = !f.imdbId;
  $('btn-play').title = f.imdbId ? '' : 'Aucun identifiant IMDb pour ce film';
  $('btn-lb').href = f.letterboxdUrl;
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------
let searchResults = [];
let searchSel = 0;

function openSearch() {
  $('search').classList.remove('hidden');
  $('search-input').value = '';
  renderSearch('');
  $('search-input').focus();
}

function closeSearch() {
  $('search').classList.add('hidden');
  $('search-input').blur();
}

function renderSearch(q) {
  const nq = norm(q.trim());
  searchResults = nq
    ? entries.filter((e) => [e.film.title, e.film.originalTitle, e.film.director].some((s) => norm(s).includes(nq))).slice(0, 8)
    : [];
  searchSel = 0;
  const ul = $('search-results');
  ul.innerHTML = '';
  searchResults.forEach((e, i) => {
    const li = document.createElement('li');
    if (i === searchSel) li.className = 'sel';
    const a = document.createElement('span');
    a.textContent = e.film.title;
    const b = document.createElement('span');
    b.textContent = [e.film.year, e.film.director].filter(Boolean).join(' · ');
    li.append(a, b);
    li.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      chooseSearch(i);
    });
    ul.appendChild(li);
  });
}

function chooseSearch(i) {
  const e = searchResults[i];
  closeSearch();
  if (e) travelThenSelect(e);
}

$('search-input').addEventListener('input', (e) => renderSearch(e.target.value));
$('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSearch();
  else if (e.key === 'Enter') chooseSearch(searchSel);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!searchResults.length) return;
    searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
    [...$('search-results').children].forEach((li, i) => li.classList.toggle('sel', i === searchSel));
  }
  e.stopPropagation();
});
$('search-input').addEventListener('blur', () => setTimeout(closeSearch, 120));

// ---------------------------------------------------------------------------
// Entrees
// ---------------------------------------------------------------------------
function setPointer(e) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.ny = -(e.clientY / window.innerHeight) * 2 + 1;
}

canvas.addEventListener('pointerdown', (e) => {
  setPointer(e);
  pointer.down = true;
  pointer.dragging = false;
  pointer.startX = pointer.lastX = e.clientX;
  pointer.startY = pointer.lastY = e.clientY;
  pointer.lastT = performance.now();
  state.camVel = 0;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  setPointer(e);
  pointer.inside = true;
  if (!pointer.down) return;
  const dx = e.clientX - pointer.lastX;
  const dy = e.clientY - pointer.lastY;
  const now = performance.now();
  const dt = Math.max(1, now - pointer.lastT) / 1000;
  if (!pointer.dragging && Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > 6) {
    pointer.dragging = true;
    canvas.style.cursor = 'grabbing';
    setHovered(null);
  }
  if (pointer.dragging) {
    if (state.focus) {
      state.forceFront = false;
      state.yaw += dx * 0.011;
      state.pitch = clamp(state.pitch + dy * 0.007, -0.7, 0.7);
      state.yawVel = (dx * 0.011) / dt;
    } else {
      const wpp = (visibleHalfWidth() * 2) / window.innerWidth;
      state.camXTarget = clamp(state.camXTarget - dx * wpp, state.minX - 0.15, state.maxX + 0.15);
      state.camX = damp(state.camX, state.camXTarget, 30, dt);
      state.camVel = (-dx * wpp) / dt;
    }
  }
  pointer.lastX = e.clientX;
  pointer.lastY = e.clientY;
  pointer.lastT = now;
});

canvas.addEventListener('pointerup', (e) => {
  setPointer(e);
  pointer.down = false;
  canvas.style.cursor = 'default';
  if (performance.now() - pointer.lastT > 80) {
    state.camVel = 0;
    if (Math.abs(state.yawVel) < 3) state.yawVel = 0;
  }
  if (pointer.dragging) {
    pointer.dragging = false;
    return;
  }
  const hit = pick();
  if (state.focus) {
    if (hit === state.focus) flip();
    else if (hit) select(hit);
    else putBack();
  } else if (hit) {
    select(hit);
  }
});

canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
  if (!state.focus) setHovered(null);
});

window.addEventListener('wheel', (e) => {
  if (e.target.closest('.overview, #search-results, .index')) return;
  e.preventDefault();
  if (state.focus) return;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  state.camXTarget = clamp(state.camXTarget + d * 0.0018, state.minX, state.maxX);
  state.camVel = 0;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const key = e.key;
  if (key === '/') {
    e.preventDefault();
    openSearch();
  } else if (key === 'r' || key === 'R') {
    random();
  } else if (key === 'Escape') {
    putBack();
  } else if (key === 'Enter') {
    if (state.focus) play();
    else if (state.cursor >= 0) select(entries[state.cursor]);
  } else if (key === 'f' || key === 'F') {
    flip();
  } else if (key.startsWith('Arrow') && entries.length) {
    e.preventDefault();
    if (state.focus) {
      if (key === 'ArrowLeft') step(-1);
      if (key === 'ArrowRight') step(1);
      return;
    }
    if (state.cursor < 0) {
      let best = 0;
      entries.forEach((en, i) => {
        if (Math.abs(en.homePos.x - state.camX) < Math.abs(entries[best].homePos.x - state.camX)) best = i;
      });
      state.cursor = best;
    } else {
      const delta = { ArrowLeft: -ROWS, ArrowRight: ROWS, ArrowUp: -1, ArrowDown: 1 }[key];
      state.cursor = clamp(state.cursor + delta, 0, entries.length - 1);
    }
    const en = entries[state.cursor];
    setHovered(en);
    state.camXTarget = clamp(en.homePos.x, state.minX, state.maxX);
  }
});

$('btn-search').addEventListener('click', openSearch);
$('btn-random').addEventListener('click', random);
$('btn-flip').addEventListener('click', flip);
$('btn-play').addEventListener('click', play);
$('btn-back').addEventListener('click', putBack);

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 40 : CAM.fov;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  finish.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  if (entries.length) updateRange();
}
window.addEventListener('resize', onResize);
onResize();

// ---------------------------------------------------------------------------
// Boucle
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const e1 = new THREE.Euler();
const lookTarget = new THREE.Vector3();
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

function updateCamera(dt, t) {
  if (!pointer.down && Math.abs(state.camVel) > 0.001) {
    state.camXTarget += state.camVel * dt;
    state.camVel *= Math.exp(-5 * dt);
    if (state.camXTarget < state.minX || state.camXTarget > state.maxX) state.camVel *= 0.5;
  }
  if (!pointer.down) state.camXTarget = damp(state.camXTarget, clamp(state.camXTarget, state.minX, state.maxX), 8, dt);
  state.camX = damp(state.camX, state.camXTarget, state.focus ? 3.5 : 6, dt);

  const free = 1 - state.focusAmt;
  state.px = damp(state.px, pointer.inside && !pointer.down ? pointer.nx : 0, 2.5, dt);
  state.py = damp(state.py, pointer.inside && !pointer.down ? pointer.ny : 0, 2.5, dt);

  let intro = 1;
  if (state.introT >= 0 && state.introT < 1) {
    state.introT = Math.min(1, state.introT + dt / 2.6);
  }
  intro = easeOut(Math.max(0, state.introT));

  const breathe = Math.sin(t * 0.4) * 0.004;
  camera.position.set(
    state.camX + state.px * 0.07 * free,
    CAM.y + state.py * 0.04 * free + breathe + (1 - intro) * 0.25,
    CAM.z + (1 - intro) * 1.8 - state.focusAmt * 0.12,
  );
  lookTarget.set(state.camX + state.px * 0.02 * free, CAM.lookY + (1 - intro) * 0.1, 0);
  camera.lookAt(lookTarget);
  camera.updateMatrixWorld();
}

function stagedTarget(t, outPos, outQuat) {
  const narrow = isNarrow();
  const d = narrow ? 0.7 : 0.42;
  const halfH = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfW = halfH * camera.aspect;
  camera.getWorldDirection(v1);
  v2.setFromMatrixColumn(camera.matrixWorld, 0);
  v3.setFromMatrixColumn(camera.matrixWorld, 1);
  outPos.copy(camera.position).addScaledVector(v1, d);
  if (narrow) outPos.addScaledVector(v3, halfH * 0.5);
  else outPos.addScaledVector(v2, -halfW * 0.3);
  outPos.addScaledVector(v3, Math.sin(t * 1.1) * 0.0025);

  e1.set(state.pitch + Math.sin(t * 0.7) * 0.02, state.yaw + Math.sin(t * 0.5) * 0.035, 0);
  outQuat.copy(camera.quaternion).multiply(q1.setFromEuler(e1));
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

function updateCases(dt, t) {
  // rotation libre du boitier sorti : inertie puis retour sur une face
  if (!(pointer.down && pointer.dragging && state.focus)) {
    if (Math.abs(state.yawVel) > 0.6) {
      state.yaw += state.yawVel * dt;
      state.yawVel *= Math.exp(-2.8 * dt);
      const unit = state.forceFront ? Math.PI * 2 : Math.PI;
      state.yawGoal = Math.round(state.yaw / unit) * unit;
    } else {
      state.yawVel = 0;
      state.yaw = damp(state.yaw, state.yawGoal, 5, dt);
    }
    state.pitch = damp(state.pitch, 0, 3.5, dt);
  }

  for (const e of entries) {
    const hoverTarget = e === state.hovered && !state.focus ? 1 : 0;
    e.pull = damp(e.pull, hoverTarget, 12, dt);

    if (e.mode === 'staged') {
      stagedTarget(t, tmpPos, tmpQuat);
      const k = 1 - Math.exp(-7 * dt);
      e.group.position.lerp(tmpPos, k);
      e.group.quaternion.slerp(tmpQuat, 1 - Math.exp(-6.5 * dt));
    } else {
      tmpPos.copy(e.homePos);
      tmpPos.z += 0.05 * e.pull;
      tmpPos.y += 0.012 * e.pull;
      tmpEuler.set(-e.lean * (1 - 0.85 * e.pull), e.homeRot.y * (1 - e.pull), e.homeRot.z * (1 - e.pull));
      tmpQuat.setFromEuler(tmpEuler);
      const lambda = e.settled ? 22 : 6;
      e.group.position.lerp(tmpPos, 1 - Math.exp(-lambda * dt));
      e.group.quaternion.slerp(tmpQuat, 1 - Math.exp(-lambda * dt));
      if (!e.settled && e.group.position.distanceTo(tmpPos) < 0.003) e.settled = true;
    }

    const away = e.group.position.distanceTo(e.homePos);
    e.shadow.material.opacity = 0.7 * clamp(1 - away / 0.08, 0, 1) * (1 - 0.35 * e.pull);
  }
}

function updateLights(dt) {
  state.focusAmt = damp(state.focusAmt, state.focus ? 1 : 0, 4, dt);
  const f = state.focusAmt;
  rowLights.forEach((l) => { l.intensity = ROW_LIGHT_INTENSITY * (1 - 0.88 * f); });
  M.strip.color.setRGB(1, 0.92, 0.8).multiplyScalar(2.2 * (1 - 0.75 * f));
  signMat.color.copy(SIGN_COLOR).multiplyScalar(1 - 0.8 * f);
  hemi.intensity = 0.35 * (1 - 0.8 * f);
  focusLight.intensity = 2.2 * f;
  rimLight.intensity = 0.5 * f;
  finish.uniforms.uVignette.value = 0.4 + 0.5 * f;
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateCamera(dt, t);
  if (!state.focus && pointer.inside && !pointer.down && entries.length) setHovered(pick());
  updateCases(dt, t);
  updateLights(dt);
  if (!state.focus) updateIndex();

  finish.uniforms.uTime.value = t;
  composer.render(dt);
}

frame();
boot();

