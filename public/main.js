import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Constantes et dimensions (proportions DVD reelles : 135 x 190 x 14 mm)
// ---------------------------------------------------------------------------
const CASE_HEIGHT = 1;
const CASE_WIDTH = 0.72; // profondeur quand le boitier est range spine-out
const CASE_THICKNESS = 0.075; // epaisseur de la tranche visible sur l'etagere
const CASE_GAP = 0.006;

const SHELF_WIDTH = 4.2;
const SHELF_PLANK_THICKNESS = 0.06;
const SHELF_LEVEL_HEIGHT = CASE_HEIGHT + 0.22;
const SHELF_DEPTH = CASE_WIDTH + 0.1;

const STAGE_POSITION = new THREE.Vector3(0, 1.55, 2.3);

// ---------------------------------------------------------------------------
// Etat global
// ---------------------------------------------------------------------------
let scene, camera, renderer, controls, raycaster, pointer;
let shelfGroup;
let films = [];
let caseMeshes = []; // { group, mesh, film, originalPosition, originalQuaternion, state }
let selected = null; // reference vers un element de caseMeshes
let isFlipped = false;

const clock = new THREE.Clock();

init();
loadFilms();

// ---------------------------------------------------------------------------
// Initialisation de la scene
// ---------------------------------------------------------------------------
function init() {
  const canvas = document.getElementById('scene-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0806);
  scene.fog = new THREE.Fog(0x0a0806, 6, 16);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 5.5);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.5;
  controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.update();

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  setupLights();
  setupFloor();

  shelfGroup = new THREE.Group();
  scene.add(shelfGroup);

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  document.getElementById('btn-flip').addEventListener('click', flipSelected);
  document.getElementById('btn-validate').addEventListener('click', validateSelected);
  document.getElementById('btn-back').addEventListener('click', deselect);

  animate();
}

function setupLights() {
  const ambient = new THREE.AmbientLight(0x3a2f22, 1.1);
  scene.add(ambient);

  const warm = new THREE.PointLight(0xffcf8a, 18, 12, 2);
  warm.position.set(0, 3.2, 1.5);
  warm.castShadow = true;
  warm.shadow.mapSize.set(1024, 1024);
  scene.add(warm);

  const fill = new THREE.PointLight(0xffe4b0, 6, 10, 2);
  fill.position.set(-2.5, 2, 2.5);
  scene.add(fill);

  const rim = new THREE.PointLight(0x8899ff, 3, 10, 2);
  rim.position.set(2.5, 1.5, -1);
  scene.add(rim);
}

function setupFloor() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1a1512';
  ctx.fillRect(0, 0, size, size);

  const tiles = 8;
  const tileSize = size / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);

  const floorGeo = new THREE.PlaneGeometry(40, 40);
  const floorMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0.1 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ---------------------------------------------------------------------------
// Texture de bois procedurale (pour l'etagere)
// ---------------------------------------------------------------------------
function createWoodTexture() {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#6b4226');
  base.addColorStop(0.5, '#5a3620');
  base.addColorStop(1, '#4a2c1a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h;
    const grainHeight = 1 + Math.random() * 3;
    ctx.strokeStyle = `rgba(30, 15, 8, ${0.06 + Math.random() * 0.1})`;
    ctx.lineWidth = grainHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) {
      const wob = Math.sin(x * 0.02 + y) * 6 + (Math.random() - 0.5) * 4;
      ctx.lineTo(x, y + wob);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 4; i++) {
    const y = Math.random() * h;
    ctx.strokeStyle = 'rgba(20, 10, 5, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Construction de l'etagere + placement des boitiers
// ---------------------------------------------------------------------------
function buildShelf(filmsList) {
  const woodTexture = createWoodTexture();
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture, roughness: 0.75, metalness: 0.05 });

  const perRow = Math.max(1, Math.floor(SHELF_WIDTH / (CASE_THICKNESS + CASE_GAP)));
  const rowCount = Math.max(1, Math.ceil(filmsList.length / perRow));

  const totalHeight = rowCount * SHELF_LEVEL_HEIGHT + SHELF_PLANK_THICKNESS;
  const startY = 0.05;

  // Panneaux lateraux
  const sideGeo = new THREE.BoxGeometry(SHELF_PLANK_THICKNESS, totalHeight, SHELF_DEPTH);
  const leftSide = new THREE.Mesh(sideGeo, woodMat);
  leftSide.position.set(-SHELF_WIDTH / 2 - SHELF_PLANK_THICKNESS / 2, startY + totalHeight / 2, 0);
  leftSide.castShadow = true;
  leftSide.receiveShadow = true;
  shelfGroup.add(leftSide);

  const rightSide = leftSide.clone();
  rightSide.position.x = SHELF_WIDTH / 2 + SHELF_PLANK_THICKNESS / 2;
  shelfGroup.add(rightSide);

  // Panneau arriere
  const backGeo = new THREE.BoxGeometry(SHELF_WIDTH + SHELF_PLANK_THICKNESS * 2, totalHeight, 0.03);
  const backMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.9 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.set(0, startY + totalHeight / 2, -SHELF_DEPTH / 2);
  back.receiveShadow = true;
  shelfGroup.add(back);

  // Etageres horizontales (une sous chaque rangee + une tout en haut)
  const plankGeo = new THREE.BoxGeometry(SHELF_WIDTH + SHELF_PLANK_THICKNESS * 2, SHELF_PLANK_THICKNESS, SHELF_DEPTH);
  for (let level = 0; level <= rowCount; level++) {
    const plank = new THREE.Mesh(plankGeo, woodMat);
    plank.position.set(0, startY + level * SHELF_LEVEL_HEIGHT, 0);
    plank.castShadow = true;
    plank.receiveShadow = true;
    shelfGroup.add(plank);
  }

  // Placement des boitiers
  filmsList.forEach((film, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const itemsInThisRow = Math.min(perRow, filmsList.length - row * perRow);
    const rowWidth = itemsInThisRow * (CASE_THICKNESS + CASE_GAP);
    const rowStartX = -rowWidth / 2 + CASE_THICKNESS / 2;

    const x = rowStartX + col * (CASE_THICKNESS + CASE_GAP);
    const y = startY + row * SHELF_LEVEL_HEIGHT + SHELF_PLANK_THICKNESS / 2 + CASE_HEIGHT / 2 + 0.01;
    const z = 0;

    const caseEntry = createCase(film);
    caseEntry.group.position.set(x, y, z);
    caseEntry.originalPosition = caseEntry.group.position.clone();
    caseEntry.originalQuaternion = caseEntry.group.quaternion.clone();

    shelfGroup.add(caseEntry.group);
    caseMeshes.push(caseEntry);
  });
}

// ---------------------------------------------------------------------------
// Creation d'un boitier DVD (jaquette avant / tranche / dos)
// ---------------------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();
textureLoader.crossOrigin = 'anonymous';

function createSpineTexture(title, tint) {
  const w = 96;
  const h = 768;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h - 24);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#f0e6d2';
  ctx.font = 'bold 26px Georgia, serif';
  ctx.textBaseline = 'middle';
  const maxWidth = h - 48;
  let displayTitle = title;
  while (ctx.measureText(displayTitle).width > maxWidth && displayTitle.length > 3) {
    displayTitle = displayTitle.slice(0, -1);
  }
  if (displayTitle !== title) displayTitle += '...';
  ctx.fillText(displayTitle, 0, 0);
  ctx.restore();

  return new THREE.CanvasTexture(canvas);
}

function createBackTexture(film) {
  const w = 512;
  const h = 720;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#131110';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#e8c988';
  ctx.font = 'bold 28px Georgia, serif';
  wrapText(ctx, film.title, 30, 50, w - 60, 34);

  ctx.fillStyle = '#f0e6d2';
  ctx.font = '18px Georgia, serif';
  const overview = film.overview || 'Pas de synopsis disponible.';
  wrapText(ctx, overview, 30, 110, w - 60, 26);

  if (film.rating) {
    ctx.fillStyle = '#e8c988';
    ctx.font = 'bold 20px Georgia, serif';
    ctx.fillText(`Note TMDb : ${film.rating.toFixed(1)} / 10`, 30, h - 40);
  }

  return new THREE.CanvasTexture(canvas);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  const maxLines = 18;
  let lineCount = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      ctx.fillText(line, x, curY);
      line = words[n] + ' ';
      curY += lineHeight;
      lineCount++;
      if (lineCount >= maxLines) {
        ctx.fillText(line + '...', x, curY);
        return;
      }
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, curY);
}

const PLASTIC_TINTS = ['#1a1a1a', '#20181a', '#181c20', '#1c1a16'];

function createCase(film) {
  const geo = new THREE.BoxGeometry(CASE_THICKNESS, CASE_HEIGHT, CASE_WIDTH);

  const tint = PLASTIC_TINTS[Math.floor(Math.random() * PLASTIC_TINTS.length)];
  const plasticMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.35, metalness: 0.1 });

  const spineTexture = createSpineTexture(film.title, tint);
  const spineMat = new THREE.MeshStandardMaterial({ map: spineTexture, roughness: 0.5 });

  const frontMat = film.poster
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    : plasticMat.clone();

  const backTexture = createBackTexture(film);
  const backMat = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.5 });

  // Ordre des faces BoxGeometry : +X, -X, +Y, -Y, +Z, -Z
  // +X = tranche visible sur l'etagere (spine-out) ; +Z = face avant (jaquette) ; -Z = dos
  const materials = [
    spineMat, // +X (tranche, face exterieure sur l'etagere)
    plasticMat, // -X
    plasticMat, // +Y
    plasticMat, // -Y
    frontMat, // +Z (jaquette avant)
    backMat, // -Z (dos)
  ];

  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  if (film.poster) {
    textureLoader.load(film.poster, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      frontMat.map = tex;
      frontMat.color.set(0xffffff);
      frontMat.needsUpdate = true;
    });
  }

  const group = new THREE.Group();
  group.add(mesh);
  // Le boitier est tourne de -90deg sur Y pour que la tranche (+X) pointe vers l'aisle (+Z)
  group.rotation.y = -Math.PI / 2;

  return {
    group,
    mesh,
    film,
    originalPosition: null,
    originalQuaternion: null,
    state: 'shelved', // shelved | out | staged
  };
}

// ---------------------------------------------------------------------------
// Chargement des films depuis l'API
// ---------------------------------------------------------------------------
async function loadFilms() {
  const loadingText = document.getElementById('loading-text');
  const loadingFill = document.getElementById('loading-bar-fill');

  try {
    loadingText.textContent = 'Recuperation de la watchlist...';
    loadingFill.style.width = '30%';

    const res = await fetch('/api/films');
    const data = await res.json();
    films = data.films || [];

    loadingText.textContent = `Rangement de ${films.length} films...`;
    loadingFill.style.width = '70%';

    buildShelf(films);

    loadingFill.style.width = '100%';
    setTimeout(() => {
      document.getElementById('loading-screen').classList.add('hidden');
    }, 300);
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Erreur au chargement de la watchlist.';
  }
}

// ---------------------------------------------------------------------------
// Interaction : clic sur un boitier
// ---------------------------------------------------------------------------
function onPointerDown(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const meshes = caseMeshes.map((c) => c.mesh);
  const intersects = raycaster.intersectObjects(meshes, false);

  if (intersects.length === 0) return;

  const hitMesh = intersects[0].object;
  const entry = caseMeshes.find((c) => c.mesh === hitMesh);
  if (!entry) return;

  if (selected && selected !== entry) {
    deselect();
  }

  if (entry.state === 'shelved') {
    selectCase(entry);
  }
}

function selectCase(entry) {
  selected = entry;
  entry.state = 'staged';
  isFlipped = false;

  const target = STAGE_POSITION.clone();
  const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));

  animateTo(entry, target, targetQuat);

  showDetailPanel(entry.film);
  document.getElementById('hint').classList.add('hidden');
}

function flipSelected() {
  if (!selected) return;
  isFlipped = !isFlipped;
  const targetY = isFlipped ? Math.PI : 0;
  const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetY, 0));
  animateTo(selected, STAGE_POSITION.clone(), targetQuat);
}

function validateSelected() {
  if (!selected) return;
  const { imdbId } = selected.film;
  if (!imdbId) return;

  const stremioUrl = `stremio://detail/movie/${imdbId}/${imdbId}`;
  window.location.href = stremioUrl;
}

function deselect() {
  if (!selected) return;
  const entry = selected;
  entry.state = 'shelved';
  animateTo(entry, entry.originalPosition.clone(), entry.originalQuaternion.clone());
  selected = null;
  isFlipped = false;

  document.getElementById('detail-panel').classList.add('hidden');
  document.getElementById('hint').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Animation simple (lerp/slerp vers une cible)
// ---------------------------------------------------------------------------
const animating = new Map(); // entry -> { targetPos, targetQuat }

function animateTo(entry, targetPos, targetQuat) {
  animating.set(entry, { targetPos, targetQuat });
}

function updateAnimations(delta) {
  const speed = Math.min(1, delta * 6);
  animating.forEach((target, entry) => {
    entry.group.position.lerp(target.targetPos, speed);
    entry.group.quaternion.slerp(target.targetQuat, speed);

    const posDone = entry.group.position.distanceTo(target.targetPos) < 0.001;
    const quatDone = entry.group.quaternion.angleTo(target.targetQuat) < 0.001;
    if (posDone && quatDone) {
      entry.group.position.copy(target.targetPos);
      entry.group.quaternion.copy(target.targetQuat);
      animating.delete(entry);
    }
  });
}

// ---------------------------------------------------------------------------
// UI panel
// ---------------------------------------------------------------------------
function showDetailPanel(film) {
  document.getElementById('detail-title').textContent = film.title;
  document.getElementById('detail-meta').textContent = [
    film.year || '',
    film.rating ? `${film.rating.toFixed(1)} / 10` : '',
  ].filter(Boolean).join(' — ');
  document.getElementById('detail-overview').textContent = film.overview || 'Pas de synopsis disponible.';

  const validateBtn = document.getElementById('btn-validate');
  validateBtn.disabled = !film.imdbId;
  validateBtn.title = film.imdbId ? '' : "Aucun identifiant IMDb trouve pour ce film";

  document.getElementById('detail-panel').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Boucle de rendu
// ---------------------------------------------------------------------------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  updateAnimations(delta);
  controls.update();
  renderer.render(scene, camera);
}
