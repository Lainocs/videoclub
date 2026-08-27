import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Constantes et dimensions (proportions DVD reelles : 135 x 190 x 14 mm)
// ---------------------------------------------------------------------------
const CASE_HEIGHT = 1;
const CASE_WIDTH = 0.72; // profondeur quand le boitier est range spine-out
const CASE_THICKNESS = 0.075; // epaisseur de la tranche visible sur l'etagere
const CASE_GAP = 0.006;

const ITEMS_PER_ROW = 30; // nombre fixe de boitiers par etage
const SHELF_PLANK_THICKNESS = 0.05;
const SHELF_LEVEL_HEIGHT = CASE_HEIGHT + 0.16;
const SHELF_DEPTH = CASE_WIDTH + 0.1;

const STAGE_DISTANCE = 2.1; // distance devant la camera ou vient se placer le boitier
const FRONT_FACING_OFFSET = -Math.PI / 2; // correction pour que +X (jaquette) fasse face a la cible du lookAt

// ---------------------------------------------------------------------------
// Etat global
// ---------------------------------------------------------------------------
let scene, camera, renderer, controls, raycaster, pointer;
let shelfGroup;
let films = [];
let caseMeshes = []; // { group, mesh, film, originalPosition, originalQuaternion, state }
let selected = null; // reference vers un element de caseMeshes
let isFlipped = false;
let hoveredEntry = null;
let keyboardIndex = -1; // position courante dans caseMeshes pour la navigation au clavier

const clock = new THREE.Clock();
const animating = new Map(); // entry -> { targetPos, targetQuat }

const forwardVector = new THREE.Vector3();
const stageTargetPosition = new THREE.Vector3();
const lookAtHelper = new THREE.Object3D();

init();
loadFilms();

// ---------------------------------------------------------------------------
// Initialisation de la scene
// ---------------------------------------------------------------------------
function init() {
  const canvas = document.getElementById('scene-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05040a);
  scene.fog = new THREE.FogExp2(0x0a0620, 0.035);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 2.1, 6.2);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.update();

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  setupLights();
  setupFloor();

  shelfGroup = new THREE.Group();
  scene.add(shelfGroup);

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);

  document.getElementById('btn-flip').addEventListener('click', flipSelected);
  document.getElementById('btn-validate').addEventListener('click', validateSelected);
  document.getElementById('btn-back').addEventListener('click', deselect);

  animate();
}

function setupLights() {
  const ambient = new THREE.AmbientLight(0x18102e, 1.4);
  scene.add(ambient);

  // Neon cyan (cote gauche)
  const cyan = new THREE.PointLight(0x00e5ff, 14, 14, 2);
  cyan.position.set(-3.5, 3, 2.5);
  scene.add(cyan);

  // Neon magenta (cote droit)
  const magenta = new THREE.PointLight(0xff2fd6, 14, 14, 2);
  magenta.position.set(3.5, 2.5, 2.5);
  scene.add(magenta);

  // Spot principal au-dessus de l'etagere, teinte violette
  const spot = new THREE.SpotLight(0xb388ff, 22, 16, Math.PI / 4, 0.4, 1.5);
  spot.position.set(0, 6, 3);
  spot.target.position.set(0, 2, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  scene.add(spot);
  scene.add(spot.target);

  // Lueur froide en fond (contre-jour bleu)
  const rim = new THREE.PointLight(0x3355ff, 8, 12, 2);
  rim.position.set(0, 3.5, -3);
  scene.add(rim);
}

function setupFloor() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b0a12';
  ctx.fillRect(0, 0, size, size);

  // Grain d'asphalte
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = Math.random() * 30;
    ctx.fillStyle = `rgba(${shade + 10}, ${shade + 8}, ${shade + 18}, 0.5)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Joints de dalles
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  const tiles = 6;
  for (let i = 1; i < tiles; i++) {
    const p = (size / tiles) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);

  const floorGeo = new THREE.PlaneGeometry(50, 50);
  const floorMat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.25,
    metalness: 0.4,
    color: 0x9999bb,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ---------------------------------------------------------------------------
// Texture metal sombre procedurale (rayonnage industriel de videoclub)
// ---------------------------------------------------------------------------
function createShelfMetalTexture() {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#2a2a34');
  base.addColorStop(0.5, '#1c1c24');
  base.addColorStop(1, '#14141a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Reflets metalliques horizontaux
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * h;
    ctx.strokeStyle = `rgba(180, 190, 220, ${0.03 + Math.random() * 0.06})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Legere teinte violette (reflet neon ambiant)
  ctx.fillStyle = 'rgba(120, 60, 200, 0.06)';
  ctx.fillRect(0, 0, w, h);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Construction de l'etagere + placement des boitiers
// ---------------------------------------------------------------------------
function buildShelf(filmsList) {
  const metalTexture = createShelfMetalTexture();
  const metalMat = new THREE.MeshStandardMaterial({ map: metalTexture, roughness: 0.4, metalness: 0.7 });

  const perRow = ITEMS_PER_ROW;
  const rowCount = Math.max(1, Math.ceil(filmsList.length / perRow));
  const shelfWidth = perRow * (CASE_THICKNESS + CASE_GAP) + 0.12;

  const totalHeight = rowCount * SHELF_LEVEL_HEIGHT + SHELF_PLANK_THICKNESS;
  const startY = 0.05;

  // Montants lateraux (metal fin, look rayonnage industriel)
  const sideGeo = new THREE.BoxGeometry(SHELF_PLANK_THICKNESS, totalHeight, SHELF_DEPTH);
  const leftSide = new THREE.Mesh(sideGeo, metalMat);
  leftSide.position.set(-shelfWidth / 2 - SHELF_PLANK_THICKNESS / 2, startY + totalHeight / 2, 0);
  leftSide.castShadow = true;
  leftSide.receiveShadow = true;
  shelfGroup.add(leftSide);

  const rightSide = leftSide.clone();
  rightSide.position.x = shelfWidth / 2 + SHELF_PLANK_THICKNESS / 2;
  shelfGroup.add(rightSide);

  // Panneau arriere sombre
  const backGeo = new THREE.BoxGeometry(shelfWidth + SHELF_PLANK_THICKNESS * 2, totalHeight, 0.03);
  const backMat = new THREE.MeshStandardMaterial({ color: 0x0d0d14, roughness: 0.6, metalness: 0.3 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.set(0, startY + totalHeight / 2, -SHELF_DEPTH / 2);
  back.receiveShadow = true;
  shelfGroup.add(back);

  // Etageres horizontales + tube neon lumineux sous chaque niveau
  const plankGeo = new THREE.BoxGeometry(shelfWidth + SHELF_PLANK_THICKNESS * 2, SHELF_PLANK_THICKNESS, SHELF_DEPTH);
  const neonColors = [0x00e5ff, 0xff2fd6];

  for (let level = 0; level <= rowCount; level++) {
    const plank = new THREE.Mesh(plankGeo, metalMat);
    plank.position.set(0, startY + level * SHELF_LEVEL_HEIGHT, 0);
    plank.castShadow = true;
    plank.receiveShadow = true;
    shelfGroup.add(plank);

    // Tube neon fin sous chaque etagere (sauf la toute derniere du haut)
    if (level < rowCount) {
      const neonColor = neonColors[level % neonColors.length];
      const tubeGeo = new THREE.BoxGeometry(shelfWidth, 0.015, 0.015);
      const tubeMat = new THREE.MeshBasicMaterial({ color: neonColor });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.position.set(0, startY + level * SHELF_LEVEL_HEIGHT - SHELF_PLANK_THICKNESS / 2 - 0.02, SHELF_DEPTH / 2 - 0.02);
      shelfGroup.add(tube);

      const tubeLight = new THREE.PointLight(neonColor, 2.5, 3, 2);
      tubeLight.position.copy(tube.position);
      shelfGroup.add(tubeLight);
    }
  }

  buildSign(totalHeight, shelfWidth);

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

  controls.target.set(0, totalHeight * 0.45, 0);
  camera.position.set(0, totalHeight * 0.55, Math.max(6, totalHeight * 1.5));
  controls.maxDistance = Math.max(9, totalHeight * 2.2);
  controls.update();
}

// ---- Enseigne neon "VIDEO CLUB" flottante au-dessus de l'etagere ----
function buildSign(totalHeight, shelfWidth) {
  const w = 1024;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 110px "Arial Black", sans-serif';

  // Halo
  ctx.shadowColor = '#ff2fd6';
  ctx.shadowBlur = 35;
  ctx.fillStyle = '#ff2fd6';
  ctx.fillText('VIDEO CLUB', w / 2, h / 2);

  ctx.shadowBlur = 15;
  ctx.fillStyle = '#ffe0fb';
  ctx.fillText('VIDEO CLUB', w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const signMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const signWidth = Math.max(2.4, Math.min(4.5, shelfWidth * 1.15));
  const signGeo = new THREE.PlaneGeometry(signWidth, signWidth * 0.25);
  const sign = new THREE.Mesh(signGeo, signMat);
  sign.position.set(0, totalHeight + 0.9, -0.3);
  shelfGroup.add(sign);

  const signLight = new THREE.PointLight(0xff2fd6, 6, 8, 2);
  signLight.position.set(0, totalHeight + 0.9, 0.6);
  shelfGroup.add(signLight);
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
  // Le box fait CASE_THICKNESS (X) x CASE_HEIGHT (Y) x CASE_WIDTH (Z).
  // +X/-X = grandes faces (hauteur x largeur) => jaquette avant / dos.
  // +Z/-Z = faces fines (epaisseur x hauteur) => tranche (visible sur l'etagere).
  const materials = [
    frontMat, // +X (jaquette avant)
    backMat, // -X (dos, synopsis)
    plasticMat, // +Y (haut)
    plasticMat, // -Y (bas)
    spineMat, // +Z (tranche, face vers l'allee/le joueur sur l'etagere)
    plasticMat, // -Z (tranche arriere, cachee contre le fond)
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
  // Pas de rotation ici : a plat sur l'etagere, la tranche (+Z local) fait
  // deja face a l'allee (+Z monde) et les faces avant/dos (+X/-X local)
  // touchent les boitiers voisins, exactement comme sur un vrai rayonnage.

  return {
    group,
    mesh,
    film,
    spineMat,
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

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const shelvedEntries = caseMeshes.filter((c) => c.state === 'shelved');
  const meshes = shelvedEntries.map((c) => c.mesh);
  const intersects = raycaster.intersectObjects(meshes, false);

  const hitEntry = intersects.length > 0
    ? shelvedEntries.find((c) => c.mesh === intersects[0].object)
    : null;

  if (hitEntry === hoveredEntry) return;

  // Retire le highlight du precedent
  if (hoveredEntry) {
    hoveredEntry.spineMat.emissive.setHex(0x000000);
  }

  hoveredEntry = hitEntry;

  if (hoveredEntry) {
    hoveredEntry.spineMat.emissive.setHex(0x2a1a44);
    showHoverPreview(hoveredEntry.film);
    renderer.domElement.style.cursor = 'pointer';
  } else {
    hideHoverPreview();
    renderer.domElement.style.cursor = 'default';
  }
}

function showHoverPreview(film) {
  const preview = document.getElementById('hover-preview');
  document.getElementById('hover-title').textContent = film.title;
  document.getElementById('hover-year').textContent = film.year || '';
  preview.classList.remove('hidden');
}

function hideHoverPreview() {
  document.getElementById('hover-preview').classList.add('hidden');
}

// ---- Navigation clavier : fleches pour parcourir, Entree/R/S/Echap pour agir ----
function onKeyDown(event) {
  const key = event.key.toLowerCase();

  if (key === 'arrowright' || key === 'arrowdown') {
    event.preventDefault();
    navigate(1);
  } else if (key === 'arrowleft' || key === 'arrowup') {
    event.preventDefault();
    navigate(-1);
  } else if (key === 'enter') {
    event.preventDefault();
    validateSelected();
  } else if (key === 'r') {
    event.preventDefault();
    flipSelected();
  } else if (key === 's' || key === 'escape') {
    event.preventDefault();
    deselect();
  }
}

function navigate(step) {
  if (caseMeshes.length === 0) return;

  if (keyboardIndex === -1) {
    keyboardIndex = 0;
  } else {
    keyboardIndex = (keyboardIndex + step + caseMeshes.length) % caseMeshes.length;
  }

  const entry = caseMeshes[keyboardIndex];
  if (!entry) return;

  if (selected && selected !== entry) {
    deselect();
  }

  if (entry.state === 'shelved') {
    selectCase(entry);
  }
}

function selectCase(entry) {
  if (hoveredEntry === entry) {
    entry.spineMat.emissive.setHex(0x000000);
    hoveredEntry = null;
    hideHoverPreview();
  }

  selected = entry;
  entry.state = 'staged';
  isFlipped = false;
  keyboardIndex = caseMeshes.indexOf(entry);

  showDetailPanel(entry.film);
  document.getElementById('hint').classList.add('hidden');
}

function flipSelected() {
  if (!selected) return;
  isFlipped = !isFlipped;
}

function validateSelected() {
  if (!selected) return;
  const { imdbId } = selected.film;
  if (!imdbId) return;

  // Important : 3 slashs (host vide), pas 2. Avec 2 slashs, Stremio
  // interprete "detail" comme un nom de domaine d'ou proviendrait un addon
  // (meme format que stremio://mon-addon.exemple.com/manifest.json), ce qui
  // declenche l'erreur "addon invalide". Avec 3 slashs, le chemin /detail/...
  // est traite comme une navigation interne vers la fiche du film.
  const stremioUrl = `stremio:///detail/movie/${imdbId}/${imdbId}`;
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

// ---- Fait suivre le boitier selectionne devant la camera, quel que soit
// l'angle de vue actuel (recalcule a chaque frame) ----
function updateStagedCase(delta) {
  if (!selected || selected.state !== 'staged') return;

  camera.getWorldDirection(forwardVector);
  stageTargetPosition.copy(camera.position).addScaledVector(forwardVector, STAGE_DISTANCE);

  lookAtHelper.position.copy(stageTargetPosition);
  lookAtHelper.lookAt(camera.position);
  lookAtHelper.rotateY(FRONT_FACING_OFFSET + (isFlipped ? Math.PI : 0));

  const speed = Math.min(1, delta * 8);
  selected.group.position.lerp(stageTargetPosition, speed);
  selected.group.quaternion.slerp(lookAtHelper.quaternion, speed);
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
  updateStagedCase(delta);
  controls.update();
  renderer.render(scene, camera);
}
