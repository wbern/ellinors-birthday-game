// Ellinor's birthday game — 3D hidden-object game
// Style target: Untitled Goose Game (soft pastels, flat-ish shading, soft shadows, no textures).

import * as THREE from 'three';
window.THREE = THREE;

// ============================================================
//  Scene, camera, renderer
// ============================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5efe6);
scene.fog = new THREE.Fog(0xf5efe6, 14, 28);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.05,
  100,
);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
//  Room object registry — a single source of truth for placed
//  things in the scene. Each entry pairs a THREE.Group with an
//  optional XZ AABB used by goose collision + tap-walk nav.
//  Builders should call placeObject(group, options) instead of
//  scene.add(group) so the hitbox follows the visual.
// ============================================================
const roomObjects = [];
const blockingAABBs = [];          // [name, minX, minZ, maxX, maxZ]
window.__roomObjects = roomObjects;
window.__blockingAABBs = blockingAABBs;
window.__scene = scene;

// ============================================================
//  Lighting — warm UGG-style
// ============================================================
const hemi = new THREE.HemisphereLight(0xfff3e0, 0xd9b994, 0.65);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.position.set(-3, 7, -5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 25;
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const ambient = new THREE.AmbientLight(0xfae8d4, 0.35);
scene.add(ambient);

// Soft warm fill light from the window direction
const fill = new THREE.DirectionalLight(0xfde4c4, 0.4);
fill.position.set(0, 3, -6);
scene.add(fill);

// Sunbeam streaming through the window onto the floor near the bed.
// Lower intensity + wider penumbra so the light feathers into the floor instead
// of cutting a hard bright disc.
const sunbeam = new THREE.SpotLight(0xfff4d8, 1.2, 9, Math.PI * 0.26, 0.85, 1.8);
sunbeam.position.set(0, 1.85, -4.2);
sunbeam.target.position.set(0.6, 0, 0.3);
scene.add(sunbeam);
scene.add(sunbeam.target);
// The matching visible shaft + floor patch are created below, right after
// the window itself is built (needs ROOM dimensions which aren't in scope yet).

// ============================================================
//  Material helpers — soft, pastel, flat-ish
// ============================================================
function mat(color, opts = {}) {
  const { flat, flatShading, ...rest } = opts;
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.92,
    metalness: 0,
    flatShading: flatShading ?? flat ?? false,
    ...rest,
  });
}

const PAL = {
  wallTop: 0xf7efe4,
  wallSide: 0xf2e8d8,
  floor: 0xd8a776,
  floorDark: 0xb4814a,
  bedWhite: 0xfaf6ee,
  bedAccent: 0xf4c8c8,
  pinkSheet: 0xf6cfcb,
  blanketPink: 0xf2b8c4,
  wood: 0xdfb98a,
  woodDark: 0xb88a5a,
  pikachu: 0xf2c94c,
  pikachuDark: 0xc88f1f,
  hedgehog: 0xf5d9f0,
  rainbow: [0xf6b8c4, 0xf6d6a4, 0xf6efb4, 0xb8e5c4, 0xbcd3f0, 0xd5bce8],
  cartYellow: 0xf4d55c,
  blackboard: 0x3a4a3a,
  green: 0xb8c89a,
  letter: 0xf5b8c2,
  letterText: 0x3a2e2a,
  candle: 0xfff4e0,
  candleAlt: 0xf6cfcb,
  flame: 0xffb04a,
  flameCore: 0xfff2b0,
  lampshade: 0xfffaf2,
  helloKittyWhite: 0xfaf6ee,
  helloKittyPink: 0xf4a8b8,
  cardBoard: 0xd2a875,
  stringLight: 0xfff2b0,
  skyBlue: 0xc8d8e8,
  trees: 0x8aa68a,
};

// ============================================================
//  Game state
// ============================================================
const game = {
  letters: [
    { key: 'E', label: 'E', found: false },
    { key: 'L1', label: 'L', found: false },
    { key: 'L2', label: 'L', found: false },
    { key: 'I', label: 'I', found: false },
    { key: 'N', label: 'N', found: false },
    { key: 'O', label: 'O', found: false },
    { key: 'R', label: 'R', found: false },
  ],
  candleTotal: 8,
  candlesFound: 0,
  interactables: [], // array of meshes with userData.onTap
  hovered: null,
};

// ============================================================
//  Sound — Web Audio synth (no external assets)
// ============================================================
const audio = {
  ctx: null,
  gain: null,
  enabled: true,
  honkBuffers: [],
  honkLoading: null,
};
// Real Untitled-Goose-style honks: the five "base" voice samples from
// wav_dumps. Each tap picks one at random with a tiny pitch jitter for variety.
const HONK_FILES = [
  'assets/honks/sfx_goose_honk_b_01.wav',
  'assets/honks/sfx_goose_honk_b_02.wav',
  'assets/honks/sfx_goose_honk_b_03.wav',
  'assets/honks/sfx_goose_honk_b_05.wav',
  'assets/honks/sfx_goose_honk_b_06.wav',
];
async function loadHonkBuffer() {
  if (audio.honkBuffers.length || audio.honkLoading) return audio.honkLoading;
  const ctx = audioInit();
  if (!ctx) return null;
  audio.honkLoading = (async () => {
    try {
      audio.honkBuffers = await Promise.all(
        HONK_FILES.map(async (url) => {
          const res = await fetch(url);
          const ab = await res.arrayBuffer();
          return ctx.decodeAudioData(ab);
        }),
      );
    } catch (e) {
      console.warn('Honk samples failed to load:', e);
    }
    return audio.honkBuffers;
  })();
  return audio.honkLoading;
}
function audioInit() {
  if (audio.ctx) return audio.ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { audio.enabled = false; return null; }
  audio.ctx = new Ctx();
  audio.gain = audio.ctx.createGain();
  audio.gain.gain.value = 0.18;
  audio.gain.connect(audio.ctx.destination);
  return audio.ctx;
}
function tone(freq, dur = 0.18, type = 'sine', when = 0, vol = 1.0) {
  if (!audio.enabled) return;
  const ctx = audioInit();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol * 0.5, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(audio.gain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
const SFX = {
  letter: () => { tone(880, 0.12, 'triangle'); tone(1320, 0.18, 'triangle', 0.06); },
  candle: () => { tone(660, 0.1, 'sine'); tone(990, 0.12, 'sine', 0.05); },
  open: () => { tone(220, 0.18, 'sawtooth', 0, 0.4); tone(330, 0.18, 'sine', 0.05, 0.5); },
  honk: () => {
    if (!audio.enabled) return;
    const ctx = audioInit();
    if (!ctx) return;
    if (!audio.honkBuffers.length) { loadHonkBuffer(); return; }
    const buf = audio.honkBuffers[Math.floor(Math.random() * audio.honkBuffers.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.16;
    const dur = buf.duration / src.playbackRate.value;
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1.0, t0 + 0.01);
    g.gain.setValueAtTime(1.0, t0 + Math.max(0.02, dur - 0.06));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(g).connect(audio.gain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  },
  win: () => {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((f, i) => tone(f, 0.32, 'triangle', i * 0.14, 0.9));
    tone(1318.5, 0.6, 'sine', 0.6, 0.7);
  },
};

// Quirky background music — a 16-step loop in C major over a
// I → IV → vi → V chord progression. Synthesised on the existing Web Audio
// graph so it shares the master gain with SFX.
const MUSIC = {
  running: false,
  timer: null,
  i: 0,
  step: 0.20,   // seconds per 8th note (≈ 150 BPM feel)
  // 16 cells, four bars of four 8th-notes. nulls = rests.
  melody: [
    523.25, 659.25, 783.99, 880.00,   // C5  E5  G5  A5
    783.99, 659.25, 698.46, 587.33,   // G5  E5  F5  D5
    659.25, 783.99, 1046.50, 880.00,  // E5  G5  C6  A5
    783.99, 698.46, 659.25, 523.25,   // G5  F5  E5  C5
  ],
  bass: [
    130.81, null,   null,   null,     // C3  (I)   — bar 1 melody C E G A fits Cmaj
    196.00, null,   null,   null,     // G3  (V)   — bar 2 melody G E F D fits G7
    220.00, null,   null,   null,     // A3  (vi)  — bar 3 melody E G C A fits Am7
    174.61, null,   null,   null,     // F3  (IV)  — bar 4 melody G F E C fits Fmaj9
  ],
};
function startMusic() {
  if (MUSIC.running) return;
  const ctx = audioInit();
  if (!ctx) return;
  MUSIC.running = true;
  MUSIC.i = 0;
  const tick = () => {
    if (!MUSIC.running || !audio.enabled) return;
    const mFreq = MUSIC.melody[MUSIC.i];
    const bFreq = MUSIC.bass[MUSIC.i];
    if (mFreq) tone(mFreq, MUSIC.step * 0.92, 'triangle', 0, 0.32);
    if (bFreq) tone(bFreq, MUSIC.step * 1.6,  'sine',     0, 0.42);
    MUSIC.i = (MUSIC.i + 1) % MUSIC.melody.length;
  };
  tick();
  MUSIC.timer = setInterval(tick, MUSIC.step * 1000);
}
function stopMusic() {
  MUSIC.running = false;
  if (MUSIC.timer) { clearInterval(MUSIC.timer); MUSIC.timer = null; }
}
window.startMusic = startMusic;
window.stopMusic = stopMusic;

// Total interactable list (for tap raycast). Each entry: { mesh, onTap, label? }
const interactRoot = new THREE.Group();
scene.add(interactRoot);

function registerInteract(mesh, onTap, opts = {}) {
  mesh.userData.onTap = onTap;
  mesh.userData.interactable = true;
  if (opts.label !== undefined) mesh.userData.label = opts.label;
  // Tag all child meshes too so raycaster hits work on grouped objects.
  mesh.traverse(c => {
    if (c.isMesh) {
      c.userData.rootInteract = mesh;
    }
  });
  game.interactables.push(mesh);
}

// Small reusable reaction for tappable decor: short hop + wiggle + chirp.
function wiggleObj(grp, opts = {}) {
  if (grp.userData._wiggling) return;
  grp.userData._wiggling = true;
  const baseRotY = grp.rotation.y;
  const baseY = grp.position.y;
  const start = performance.now();
  const duration = opts.duration ?? 420;
  const lift = opts.lift ?? 0.05;
  const sway = opts.sway ?? 0.20;
  (function step() {
    const t = (performance.now() - start) / duration;
    if (t >= 1) {
      grp.rotation.y = baseRotY;
      grp.position.y = baseY;
      grp.userData._wiggling = false;
      return;
    }
    const decay = 1 - t;
    grp.rotation.y = baseRotY + Math.sin(t * Math.PI * 6) * sway * decay;
    grp.position.y = baseY + Math.abs(Math.sin(t * Math.PI * 2)) * lift * decay;
    requestAnimationFrame(step);
  })();
}

function tapWiggle(grp, freq, label, opts = {}) {
  registerInteract(grp, () => {
    tone(freq, 0.12, 'triangle');
    tone(freq * 1.5, 0.14, 'triangle', 0.05);
    wiggleObj(grp, opts);
  }, { label });
}

// placeObject — single source of truth for adding things to the room.
// Couples a THREE.Object3D with its blocking XZ footprint so collision +
// pathfinding stay in sync with the visuals. Builders should compose
// their geometry into a Group with local coordinates, then call this
// instead of scene.add().
//
// options:
//   x, y, z      world translation (default 0)
//   yaw,pitch,roll  Y/X/Z rotation in radians (default 0)
//   scale        uniform scale (default 1)
//   parent       parent Object3D (default scene)
//   name         label for AABB entry + debug
//   interact     onTap callback — if set, registerInteract is wired up
//   noFade       mark this + descendants as never-fade for X-ray
//   blocking     false (default) | true | Object3D | {minX,minZ,maxX,maxZ}
//                  true: auto-AABB from full group bounds
//                  Object3D: auto-AABB from that node's bounds
//                  rect: use explicit world-space rect
function placeObject(group, options = {}) {
  const {
    x = 0, y = 0, z = 0,
    yaw = 0, pitch = 0, roll = 0,
    scale = 1,
    parent = scene,
    name,
    interact,
    noFade = false,
    blocking = false,
  } = options;
  group.position.set(x, y, z);
  if (yaw)   group.rotation.y = yaw;
  if (pitch) group.rotation.x = pitch;
  if (roll)  group.rotation.z = roll;
  if (scale !== 1) group.scale.setScalar(scale);
  parent.add(group);
  if (noFade) markNoFade(group);
  if (interact) registerInteract(group, interact, { label: name });

  let aabb = null;
  if (blocking) {
    if (blocking.minX !== undefined) {
      aabb = [name ?? '?', blocking.minX, blocking.minZ, blocking.maxX, blocking.maxZ];
    } else {
      group.updateMatrixWorld(true);
      const target = (blocking === true) ? group : blocking;
      const box = new THREE.Box3().setFromObject(target);
      aabb = [name ?? '?', box.min.x, box.min.z, box.max.x, box.max.z];
    }
    blockingAABBs.push(aabb);
  }

  const entry = { group, name, aabb };
  roomObjects.push(entry);
  return entry;
}

// X-ray fade: meshes between camera and goose go semi-transparent. We tag
// objects we never want to fade (goose, room shell, letters, candles, the
// proximity orb, the tap marker). Containers (laundry, art cart, etc.) are
// intentionally NOT tagged — they should fade when they occlude the goose.
function markNoFade(root) {
  root.traverse(o => { if (o.userData) o.userData.noFade = true; });
}

// ============================================================
//  Letter texture factory (canvas)
// ============================================================
function makeLetterTexture(letter) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  // Pastel background
  ctx.fillStyle = '#fff0e6';
  ctx.fillRect(0, 0, size, size);
  // Soft border
  ctx.strokeStyle = '#e89aa6';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, size - 14, size - 14);
  // Letter
  ctx.fillStyle = '#d97b8a';
  ctx.font = 'bold 200px -apple-system, "Avenir Next", Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2 + 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildLetter(letterKey, label) {
  const group = new THREE.Group();
  const size = 0.22;
  const tex = makeLetterTexture(label);
  // 6 materials with the letter painted on each face for visibility from any angle.
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.7, metalness: 0,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0xf4a8b8, roughness: 0.7, metalness: 0,
  });
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size * 0.55),
    [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat],
  );
  cube.castShadow = true;
  cube.receiveShadow = true;
  group.add(cube);
  group.userData.letterKey = letterKey;
  group.userData.kind = 'letter';
  group.userData.label = `Bokstav ${label}`;
  group.userData.bobPhase = Math.random() * Math.PI * 2;
  group.userData.noFade = true;
  return group;
}

function buildCandle(colorMain = PAL.candle) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.22, 14),
    mat(colorMain, { roughness: 0.6 }),
  );
  body.position.y = 0.11;
  body.castShadow = true;
  g.add(body);
  // Stripe
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.051, 0.051, 0.03, 14),
    mat(PAL.helloKittyPink, { roughness: 0.6 }),
  );
  stripe.position.y = 0.16;
  g.add(stripe);
  // Wick
  const wick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.025, 6),
    mat(0x3a2e2a, { roughness: 0.9 }),
  );
  wick.position.y = 0.235;
  g.add(wick);
  // Flame
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.025, 0.07, 10),
    new THREE.MeshStandardMaterial({
      color: PAL.flame,
      emissive: PAL.flame,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    }),
  );
  flame.position.y = 0.285;
  g.add(flame);
  g.userData.kind = 'candle';
  g.userData.bobPhase = Math.random() * Math.PI * 2;
  g.userData.noFade = true;
  return g;
}

// ============================================================
//  Room shell — floor / walls (no ceiling: dollhouse view)
// ============================================================
const ROOM = { w: 4.0, d: 4.0, h: 2.6 };
const room = new THREE.Group();
scene.add(room);

// Floor — planks
const floorGeo = new THREE.PlaneGeometry(ROOM.w, ROOM.d);
const floor = new THREE.Mesh(floorGeo, mat(PAL.floor, { roughness: 0.85 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
room.add(floor);

// Plank stripes — flat strips for parquet feel without textures
for (let i = 0; i < 8; i++) {
  const x = -ROOM.w / 2 + (i + 0.5) * (ROOM.w / 8);
  const plankLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.02, ROOM.d),
    mat(PAL.floorDark, { roughness: 0.9 }),
  );
  plankLine.rotation.x = -Math.PI / 2;
  plankLine.position.set(x, 0.001, 0);
  plankLine.receiveShadow = true;
  room.add(plankLine);
}

// Walls
function addWall(w, h, x, y, z, ry, color) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(color, { roughness: 0.95, side: THREE.FrontSide }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.receiveShadow = true;
  room.add(m);
  return m;
}
// Back wall (z = -d/2), facing +z
const backWall = addWall(ROOM.w, ROOM.h, 0, ROOM.h / 2, -ROOM.d / 2, 0, PAL.wallTop);
// Left wall (x = -w/2), facing +x
const leftWall = addWall(ROOM.d, ROOM.h, -ROOM.w / 2, ROOM.h / 2, 0, Math.PI / 2, PAL.wallSide);
// Right wall (x = +w/2), facing -x
const rightWall = addWall(ROOM.d, ROOM.h, ROOM.w / 2, ROOM.h / 2, 0, -Math.PI / 2, PAL.wallSide);
// Front wall (z = +d/2), normal facing -z (toward room interior). FrontSide
// means it's invisible when the camera orbits to view from outside the room
// (dollhouse effect). A door is painted on the left side of the wall.
const frontWall = addWall(ROOM.w, ROOM.h, 0, ROOM.h / 2, ROOM.d / 2, Math.PI, PAL.wallTop);
{
  const doorW = 0.9, doorH = 2.0;
  const doorX = ROOM.w / 2 - doorW / 2 - 0.25;
  const doorMat = mat(0xfaf6ee, { roughness: 0.7 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.04), doorMat);
  door.position.set(doorX, doorH / 2, ROOM.d / 2 - 0.03);
  door.castShadow = true; door.receiveShadow = true;
  room.add(door);
  // Two recessed panels for that classic painted-door look
  for (const py of [0.55, 1.45]) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(doorW - 0.18, 0.55, 0.005),
      mat(0xeee6d8, { roughness: 0.8 }),
    );
    panel.position.set(doorX, py, ROOM.d / 2 - 0.052);
    room.add(panel);
  }
  // Door frame trim
  const trimMat = mat(0xfffaf2, { roughness: 0.7 });
  const trimTop = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.12, 0.06, 0.05), trimMat);
  trimTop.position.set(doorX, doorH + 0.03, ROOM.d / 2 - 0.02);
  room.add(trimTop);
  const trimL = new THREE.Mesh(new THREE.BoxGeometry(0.06, doorH + 0.06, 0.05), trimMat);
  trimL.position.set(doorX - doorW / 2 - 0.03, doorH / 2, ROOM.d / 2 - 0.02);
  room.add(trimL);
  const trimR = trimL.clone();
  trimR.position.x = doorX + doorW / 2 + 0.03;
  room.add(trimR);
  // Door knob (matte chrome)
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 10),
    mat(0xbfb0a0, { roughness: 0.35, metalness: 0.5 }),
  );
  knob.position.set(doorX - doorW / 2 + 0.12, 1.05, ROOM.d / 2 - 0.06);
  room.add(knob);
  // Darker wood threshold strip at the base of the door (photo 2: hallway floor visible)
  const threshold = new THREE.Mesh(
    new THREE.BoxGeometry(doorW + 0.04, 0.025, 0.08),
    mat(0x8a6b4c, { roughness: 0.8 }),
  );
  threshold.position.set(doorX, 0.013, ROOM.d / 2 - 0.05);
  threshold.receiveShadow = true;
  room.add(threshold);
  // Hello Kitty pencil sketch on the door (photo 2 detail)
  // ARCHIVED — flip to `if (true)` to restore this decoration.
  if (false) {
    const hkY = 1.30, hkZ = ROOM.d / 2 - 0.057;
    // Head outline (small)
    const head = new THREE.Mesh(
      new THREE.CircleGeometry(0.06, 24),
      mat(0xfffaf2, { roughness: 0.95 }),
    );
    head.rotation.y = Math.PI;
    head.position.set(doorX, hkY, hkZ);
    room.add(head);
    // Black outline ring
    const outline = new THREE.Mesh(
      new THREE.RingGeometry(0.058, 0.064, 24),
      mat(0x2a2520, { roughness: 0.95 }),
    );
    outline.rotation.y = Math.PI;
    outline.position.set(doorX, hkY, hkZ - 0.001);
    room.add(outline);
    // Eyes
    for (const dx of [-0.022, 0.022]) {
      const eye = new THREE.Mesh(
        new THREE.CircleGeometry(0.005, 8),
        mat(0x2a2520, { roughness: 0.95 }),
      );
      eye.rotation.y = Math.PI;
      eye.position.set(doorX + dx, hkY + 0.005, hkZ - 0.002);
      room.add(eye);
    }
    // Yellow nose
    const nose = new THREE.Mesh(
      new THREE.CircleGeometry(0.006, 8),
      mat(0xf4d55c, { roughness: 0.95 }),
    );
    nose.rotation.y = Math.PI;
    nose.position.set(doorX, hkY - 0.005, hkZ - 0.002);
    room.add(nose);
    // Pink bow (left ear)
    for (const dx of [-0.038, -0.024]) {
      const bow = new THREE.Mesh(
        new THREE.CircleGeometry(0.011, 12),
        mat(0xe96b9a, { roughness: 0.9 }),
      );
      bow.rotation.y = Math.PI;
      bow.position.set(doorX + dx, hkY + 0.045, hkZ - 0.002);
      room.add(bow);
    }
    // Whiskers — three thin lines per side
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const w = new THREE.Mesh(
          new THREE.PlaneGeometry(0.035, 0.0015),
          mat(0x2a2520, { roughness: 0.95 }),
        );
        w.rotation.y = Math.PI;
        w.position.set(doorX + side * 0.05, hkY - 0.010 + (i - 1) * 0.010, hkZ - 0.001);
        room.add(w);
      }
    }
  }
}

// Baseboard / skirting
function addBaseboard(w, x, z, ry) {
  const bb = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.08, 0.02),
    mat(0xfffaf2, { roughness: 0.8 }),
  );
  bb.position.set(x, 0.04, z);
  bb.rotation.y = ry;
  room.add(bb);
}
addBaseboard(ROOM.w, 0, -ROOM.d / 2 + 0.011, 0);
addBaseboard(ROOM.d, -ROOM.w / 2 + 0.011, 0, Math.PI / 2);
addBaseboard(ROOM.d, ROOM.w / 2 - 0.011, 0, Math.PI / 2);

// ============================================================
//  Window (back wall) — with sky view + trees
// ============================================================
{
  const winW = 1.8, winH = 1.3, winY = 1.55;
  // Sky behind window — soft gradient via canvas texture (warm horizon → cool sky)
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 64; skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#bcd3eb');
  grad.addColorStop(0.55, '#dde6ee');
  grad.addColorStop(0.75, '#f0d4c2');
  grad.addColorStop(1, '#c8b298');
  skyCtx.fillStyle = grad;
  skyCtx.fillRect(0, 0, 64, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(winW - 0.1, winH - 0.1),
    new THREE.MeshBasicMaterial({ map: skyTex }),
  );
  sky.position.set(0, winY, -ROOM.d / 2 + 0.005);
  room.add(sky);
  // Window frame
  const frameMat = mat(0xfffaf2, { roughness: 0.6 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.08, 0.06), frameMat);
  top.position.set(0, winY + winH / 2, -ROOM.d / 2 + 0.03);
  room.add(top);
  const bot = top.clone(); bot.position.y = winY - winH / 2; room.add(bot);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.08, winH + 0.08, 0.06), frameMat);
  left.position.set(-winW / 2, winY, -ROOM.d / 2 + 0.03);
  room.add(left);
  const right = left.clone(); right.position.x = winW / 2; room.add(right);
  // Mullion (cross)
  const mid = new THREE.Mesh(new THREE.BoxGeometry(0.05, winH, 0.05), frameMat);
  mid.position.set(0, winY, -ROOM.d / 2 + 0.04);
  room.add(mid);
  // Window sill
  const sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.3, 0.06, 0.18), frameMat);
  sill.position.set(0, winY - winH / 2 - 0.04, -ROOM.d / 2 + 0.12);
  sill.castShadow = true;
  room.add(sill);

  // ----- Visible volumetric sun shaft + floor patch -----
  // A soft additive-blended cone slants from the window down onto the floor,
  // plus a warm sun-patch where it lands.
  const shaftLen = 4.2;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 1.10, shaftLen, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff4cf,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const winPos = new THREE.Vector3(0, winY, -ROOM.d / 2 + 0.05);
  const floorTarget = new THREE.Vector3(0.6, 0, 0.3);
  const shaftMid = winPos.clone().add(floorTarget).multiplyScalar(0.5);
  shaft.position.copy(shaftMid);
  const shaftDir = floorTarget.clone().sub(winPos).normalize();
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shaftDir);
  shaft.userData.noFade = true;
  shaft.renderOrder = 2;
  shaft.raycast = () => {};
  scene.add(shaft);

  const patch = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 32),
    new THREE.MeshBasicMaterial({
      color: 0xfff0c4,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(floorTarget.x, 0.015, floorTarget.z);
  patch.scale.set(1.0, 1.35, 1.0);
  patch.userData.noFade = true;
  patch.renderOrder = 1;
  patch.raycast = () => {};
  scene.add(patch);
}

// ============================================================
//  Big fluffy feather pendant (Photo: signature white feather lamp)
//  ARCHIVED — flip to `if (true)` to restore.
// ============================================================
if (false) {
  const lampY = 2.30;
  const lampX = 0.0;
  const lampZ = -0.6;
  const shade = new THREE.Group();
  const shadeMat = mat(0xfffaf2, { roughness: 0.98 });
  // Core orb — bigger, dominant feature
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 16), shadeMat);
  core.castShadow = true;
  shade.add(core);
  // Outer "feather" tufts — many overlapping flattened spheres on a unit sphere.
  // Photo shows a roughly 50cm dramatic feather ball, so we double the layer count
  // and use 2 concentric shells for puffier silhouette.
  const tufts = 140;
  for (let i = 0; i < tufts; i++) {
    const t = i / tufts;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = 0.46 + Math.random() * 0.10;
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), shadeMat);
    tuft.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) - 0.04,
      r * Math.sin(phi) * Math.sin(theta),
    );
    tuft.scale.set(0.75, 1.6, 0.75);
    tuft.lookAt(0, 0, 0);
    shade.add(tuft);
  }
  // Inner ring of denser tufts to hide the core sphere edge
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
    const r = 0.34 + Math.random() * 0.05;
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), shadeMat);
    tuft.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) - 0.02,
      r * Math.sin(phi) * Math.sin(theta),
    );
    tuft.scale.set(0.75, 1.4, 0.75);
    tuft.lookAt(0, 0, 0);
    shade.add(tuft);
  }
  // Cord — long enough to clearly reach the ceiling above the lamp
  const cordLen = ROOM.h - lampY + 0.05;
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, cordLen, 6),
    mat(0xf8f3e8, { roughness: 0.6 }),
  );
  cord.position.set(0, 0.45 + cordLen / 2, 0);
  shade.add(cord);
  shade.position.set(lampX, lampY, lampZ);
  scene.add(shade);
  const lampLight = new THREE.PointLight(0xfff0d0, 0.85, 5.0, 2);
  lampLight.position.set(lampX, lampY - 0.2, lampZ);
  lampLight.castShadow = false;
  scene.add(lampLight);
}

// ============================================================
//  Fairy string lights on left/back wall
//  ARCHIVED — flip to `if (true)` to restore.
// ============================================================
if (false) {
  const stringMat = mat(PAL.stringLight, {
    emissive: PAL.stringLight, emissiveIntensity: 0.4, roughness: 0.4,
  });
  const cordMat = mat(0xeeeeee, { roughness: 0.7 });
  // Drape across left wall and partial back wall
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = -ROOM.w / 2 + 0.05;
    const z = -ROOM.d / 2 + 0.2 + t * (ROOM.d - 1.5);
    const sag = Math.sin(t * Math.PI * 3) * 0.18 - 0.1;
    pts.push(new THREE.Vector3(x, 2.35 + sag, z));
    if (i % 2 === 0) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), stringMat);
      light.position.copy(pts[pts.length - 1]);
      light.position.x += 0.04;
      room.add(light);
    }
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.006, 5, false);
  const tube = new THREE.Mesh(tubeGeo, cordMat);
  room.add(tube);
}

// ============================================================
//  Goose (player character) — UGG-style low-poly
//  Three styles selectable via ?goose=A|B|C URL param.
// ============================================================
const GOOSE_STYLES = {
  // A — Classic UGG silhouette: long S-curve neck, prominent flat bill,
  //     sleek elongated body. The most "goose-game".
  A: {
    body:    { r: 0.20, sx: 0.95, sy: 0.92, sz: 1.85, y: 0.32, z: -0.04 },
    chest:   { r: 0.17, sx: 0.85, sy: 0.80, sz: 1.05, y: 0.28, z: 0.18 },
    belly:   { r: 0.18, sx: 0.85, sy: 0.45, sz: 1.30, y: 0.16, z: 0.00 },
    tail:    { coneR: 0.10, coneH: 0.20, scaleY: 0.30, y: 0.36, z: -0.36, rotX: 0.45 },
    neckPivot: { y: 0.42, z: 0.14 },
    neckCurve: [
      [0, 0.00, -0.05],
      [0, 0.08,  0.08],
      [0, 0.22,  0.22],
      [0, 0.36,  0.36],
      [0, 0.46,  0.48],
    ],
    neckTubeR: 0.055,
    head:    { r: 0.095, sx: 1.05, sy: 0.95, sz: 1.30, posY: 0.46, posZ: 0.50 },
    bill:    {
      upper: [0.14, 0.040, 0.20], upperY: 0.020, upperZ: 0.07,
      tip:   { r: 0.075, sx: 0.95, sy: 0.30, sz: 0.55, y: 0.020, z: 0.16 },
      lower: [0.125, 0.030, 0.17], lowerY: -0.012, lowerZ: 0.07,
      pivotY: -0.012, pivotZ: 0.10,
    },
    eye:     { groupY: 0.030, groupZ: 0.04, ballR: 0.020, sx: 1.0, sy: 1.0, sz: 0.65, pupilR: 0.013, offX: 0.062 },
    feet:    { y: 0.014, offX: 0.075, padW: 0.10, padH: 0.025, padD: 0.17, leg: true },
    legR: 0.025, legH: 0.10,
  },
  // B — Plump baseline (close to original): chunkier body, shorter neck.
  B: {
    body:    { r: 0.22, sx: 1.00, sy: 0.95, sz: 1.55, y: 0.30, z: -0.02 },
    chest:   { r: 0.17, sx: 0.85, sy: 0.85, sz: 1.00, y: 0.27, z: 0.14 },
    belly:   { r: 0.18, sx: 0.85, sy: 0.50, sz: 1.20, y: 0.16, z: 0.00 },
    tail:    { coneR: 0.11, coneH: 0.18, scaleY: 0.35, y: 0.33, z: -0.32, rotX: 0.45 },
    neckPivot: { y: 0.40, z: 0.14 },
    neckCurve: [
      [0, 0.00, -0.04],
      [0, 0.06,  0.06],
      [0, 0.16,  0.18],
      [0, 0.26,  0.30],
      [0, 0.32,  0.40],
    ],
    neckTubeR: 0.068,
    head:    { r: 0.115, sx: 1.05, sy: 0.95, sz: 1.15, posY: 0.34, posZ: 0.42 },
    bill:    {
      upper: [0.12, 0.045, 0.16], upperY: 0.018, upperZ: 0.06,
      tip:   { r: 0.07, sx: 0.90, sy: 0.32, sz: 0.50, y: 0.018, z: 0.13 },
      lower: [0.105, 0.032, 0.14], lowerY: -0.010, lowerZ: 0.06,
      pivotY: -0.015, pivotZ: 0.09,
    },
    eye:     { groupY: 0.030, groupZ: 0.05, ballR: 0.022, sx: 1.0, sy: 1.0, sz: 0.65, pupilR: 0.014, offX: 0.065 },
    feet:    { y: 0.014, offX: 0.080, padW: 0.11, padH: 0.028, padD: 0.18, leg: false },
    legR: 0.025, legH: 0.08,
  },
  // C — Slim realistic goose: tall thin neck, smaller head, longer body.
  C: {
    body:    { r: 0.19, sx: 0.85, sy: 0.85, sz: 2.00, y: 0.34, z: -0.05 },
    chest:   { r: 0.16, sx: 0.80, sy: 0.75, sz: 1.05, y: 0.30, z: 0.18 },
    belly:   { r: 0.17, sx: 0.80, sy: 0.42, sz: 1.40, y: 0.18, z: 0.00 },
    tail:    { coneR: 0.09, coneH: 0.22, scaleY: 0.28, y: 0.38, z: -0.42, rotX: 0.55 },
    neckPivot: { y: 0.46, z: 0.12 },
    neckCurve: [
      [0, 0.00, -0.06],
      [0, 0.10,  0.06],
      [0, 0.26,  0.20],
      [0, 0.42,  0.34],
      [0, 0.54,  0.46],
    ],
    neckTubeR: 0.048,
    head:    { r: 0.085, sx: 1.05, sy: 0.95, sz: 1.35, posY: 0.54, posZ: 0.48 },
    bill:    {
      upper: [0.115, 0.038, 0.22], upperY: 0.018, upperZ: 0.075,
      tip:   { r: 0.07, sx: 0.95, sy: 0.28, sz: 0.55, y: 0.018, z: 0.18 },
      lower: [0.105, 0.028, 0.19], lowerY: -0.010, lowerZ: 0.075,
      pivotY: -0.010, pivotZ: 0.10,
    },
    eye:     { groupY: 0.028, groupZ: 0.04, ballR: 0.018, sx: 1.0, sy: 1.0, sz: 0.65, pupilR: 0.012, offX: 0.057 },
    feet:    { y: 0.014, offX: 0.072, padW: 0.10, padH: 0.024, padD: 0.18, leg: true },
    legR: 0.022, legH: 0.14,
  },
};
const _urlGooseStyle = new URLSearchParams(location.search).get('goose');
const GOOSE_STYLE = GOOSE_STYLES[_urlGooseStyle] ? _urlGooseStyle : 'A';
function buildGoose(styleKey = GOOSE_STYLE) {
  const S = GOOSE_STYLES[styleKey];
  const g = new THREE.Group();
  const white = mat(0xfaf6ee, { roughness: 0.95 });
  const whiteSoft = mat(0xeae3d2, { roughness: 0.95 });
  const orange = mat(0xf4a261, { roughness: 0.45 });
  const orangeDark = mat(0xd97b3a, { roughness: 0.55 });
  const black = mat(0x1a1410, { roughness: 0.4 });
  const eyeWhite = mat(0xfffaf2, { roughness: 0.35 });

  // ---------- Body ----------
  const body = new THREE.Mesh(new THREE.SphereGeometry(S.body.r, 18, 14), white);
  body.scale.set(S.body.sx, S.body.sy, S.body.sz);
  body.position.set(0, S.body.y, S.body.z);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // Chest puff — soft front shading
  const chest = new THREE.Mesh(new THREE.SphereGeometry(S.chest.r, 14, 10), whiteSoft);
  chest.scale.set(S.chest.sx, S.chest.sy, S.chest.sz);
  chest.position.set(0, S.chest.y, S.chest.z);
  g.add(chest);

  // Belly underside (slightly cream)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(S.belly.r, 12, 8), whiteSoft);
  belly.scale.set(S.belly.sx, S.belly.sy, S.belly.sz);
  belly.position.set(0, S.belly.y, S.belly.z);
  g.add(belly);

  // ---------- Tail ----------
  const tail = new THREE.Group();
  const tailWedge = new THREE.Mesh(new THREE.ConeGeometry(S.tail.coneR, S.tail.coneH, 4), white);
  tailWedge.rotation.x = Math.PI / 2;
  tailWedge.scale.set(1.0, S.tail.scaleY, 1.0);
  tailWedge.position.set(0, 0, -0.06);
  tail.add(tailWedge);
  tail.position.set(0, S.tail.y, S.tail.z);
  tail.rotation.x = S.tail.rotX;
  g.add(tail);

  // ---------- Wings (folded along body) ----------
  function buildWing(side) {
    const w = new THREE.Group();
    const main = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), whiteSoft);
    main.scale.set(0.4, 0.55, 1.05);
    w.add(main);
    // Feather tip — sweeping back wedge
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), whiteSoft);
    tip.rotation.x = Math.PI / 2;
    tip.scale.set(1.0, 0.4, 1.0);
    tip.position.set(0, -0.03, -0.18);
    w.add(tip);
    w.position.set(side * 0.2, 0.3, -0.04);
    // Tuck wings against the body
    w.rotation.z = -side * 0.08;
    w.castShadow = true;
    return w;
  }
  const leftWing = buildWing(-1);
  const rightWing = buildWing(1);
  g.add(leftWing); g.add(rightWing);

  // ---------- Neck assembly ----------
  // Single smooth S-curve tube — no visible joints. neckPivot rotates the
  // whole neck+head when honking or pecking. Forward-leaning silhouette
  // gives the unmistakable Untitled-Goose-Game profile.
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, S.neckPivot.y, S.neckPivot.z);
  g.add(neckPivot);

  const neckCurve = new THREE.CatmullRomCurve3(
    S.neckCurve.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  );
  const neck = new THREE.Mesh(
    new THREE.TubeGeometry(neckCurve, 32, S.neckTubeR, 14, false),
    white,
  );
  neck.castShadow = true;
  neckPivot.add(neck);

  // Soft collar sphere at the neck base — hides the body/neck seam
  const neckCollar = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(0.07, S.neckTubeR + 0.02), 14, 10),
    white,
  );
  neckCollar.scale.set(1.0, 0.7, 1.0);
  neckCollar.position.set(0, 0.00, -0.02);
  neckPivot.add(neckCollar);

  // ---------- Head ----------
  const head = new THREE.Group();
  head.position.set(0, S.head.posY, S.head.posZ);
  neckPivot.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(S.head.r, 16, 12), white);
  skull.scale.set(S.head.sx, S.head.sy, S.head.sz);
  skull.castShadow = true;
  head.add(skull);

  // Soft cheek shading
  const cheekR = S.head.r * 0.45;
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(cheekR, 10, 8), whiteSoft);
    cheek.scale.set(0.5, 0.6, 0.5);
    cheek.position.set(sx * S.head.r * 0.7, -0.005, S.head.r * 0.35);
    head.add(cheek);
  }

  // ---------- Bill (wide, flat, goose-style) ----------
  // billPivot rotates as a whole; billLower rotates relative for opening.
  const billPivot = new THREE.Group();
  billPivot.position.set(0, S.bill.pivotY, S.bill.pivotZ);
  head.add(billPivot);

  const billUpper = new THREE.Mesh(
    new THREE.BoxGeometry(S.bill.upper[0], S.bill.upper[1], S.bill.upper[2]),
    orange,
  );
  billUpper.position.set(0, S.bill.upperY, S.bill.upperZ);
  billUpper.castShadow = true;
  billPivot.add(billUpper);

  // Rounded tip
  const billTip = new THREE.Mesh(new THREE.SphereGeometry(S.bill.tip.r, 12, 8), orange);
  billTip.scale.set(S.bill.tip.sx, S.bill.tip.sy, S.bill.tip.sz);
  billTip.position.set(0, S.bill.tip.y, S.bill.tip.z);
  billPivot.add(billTip);

  // Lower bill — rotates open when honking
  const billLower = new THREE.Group();
  billLower.position.set(0, -0.008, 0.0);
  billPivot.add(billLower);
  const billLowerMesh = new THREE.Mesh(
    new THREE.BoxGeometry(S.bill.lower[0], S.bill.lower[1], S.bill.lower[2]),
    orangeDark,
  );
  billLowerMesh.position.set(0, S.bill.lowerY, S.bill.lowerZ);
  billLowerMesh.castShadow = true;
  billLower.add(billLowerMesh);

  // Nostrils
  for (const sx of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 6), black);
    nostril.position.set(sx * 0.025, S.bill.upperY + 0.012, S.bill.upperZ - 0.02);
    billPivot.add(nostril);
  }

  // ---------- Eyes ----------
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sx * S.eye.offX, S.eye.groupY, S.eye.groupZ);
    head.add(eyeGroup);
    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(S.eye.ballR, 12, 10), eyeWhite);
    eyeball.scale.set(S.eye.sx, S.eye.sy, S.eye.sz);
    eyeGroup.add(eyeball);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(S.eye.pupilR, 10, 8), black);
    pupil.position.z = S.eye.ballR * 0.6;
    eyeGroup.add(pupil);
    eyes.push(eyeGroup);
  }

  // ---------- Feet (webbed paddles, optional short leg) ----------
  function buildFoot(side) {
    const foot = new THREE.Group();
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(S.feet.padW, S.feet.padH, S.feet.padD),
      orange,
    );
    pad.castShadow = true;
    pad.position.set(0, 0, 0.025);
    foot.add(pad);
    // Toe ridges
    const toeSpacing = S.feet.padW * 0.35;
    for (let i = -1; i <= 1; i++) {
      const ridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, S.feet.padH + 0.006, 0.05),
        orangeDark,
      );
      ridge.position.set(i * toeSpacing, 0.005, S.feet.padD * 0.55);
      foot.add(ridge);
    }
    // Webbing between toes
    for (let i = -1; i <= 0; i++) {
      const web = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, S.feet.padH * 0.65, 0.04),
        orange,
      );
      web.position.set(i * toeSpacing + toeSpacing * 0.5, 0.004, S.feet.padD * 0.55);
      foot.add(web);
    }
    // Optional visible leg shin
    if (S.feet.leg) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(S.legR, S.legR * 0.9, S.legH, 10),
        orange,
      );
      leg.position.set(0, S.legH / 2, -0.01);
      leg.castShadow = true;
      foot.add(leg);
    }
    foot.position.set(side * S.feet.offX, S.feet.y, 0);
    return foot;
  }
  const leftFoot = buildFoot(-1);
  const rightFoot = buildFoot(1);
  g.add(leftFoot); g.add(rightFoot);

  g.userData.parts = {
    body, chest, belly, tail,
    neck: neckPivot, head,
    billPivot, billLower,
    leftWing, rightWing,
    leftFoot, rightFoot,
    leftEye: eyes[0], rightEye: eyes[1],
  };
  // Store base values so the animator can return to a rest pose.
  g.userData.base = {
    bodyY: body.position.y,
    neckRotX: 0,
    neckPosY: neckPivot.position.y,
    headY: head.position.y,
    headZ: head.position.z,
    billLowerRotX: 0,
    tailRotX: tail.rotation.x,
    leftWingRotZ: leftWing.rotation.z,
    rightWingRotZ: rightWing.rotation.z,
  };
  return g;
}

const goose = {
  obj: buildGoose(),
  // Position state — XZ only, Y is fixed
  x: 0.5,
  z: 1.6,
  facing: 0,                 // radians, 0 = +Z (forward toward camera in default yaw)
  vx: 0, vz: 0,
  speed: 1.9,                // m/s when joystick fully deflected
  moving: false,
  walkPhase: 0,
  // Body radius for collisions
  radius: 0.26,
  // Animation state
  honkTimer: 0,              // seconds remaining in honk stretch
  peckTimer: 0,              // seconds remaining in head-dip peck
  blinkTimer: 2 + Math.random() * 3,  // countdown to next blink
  blinkPhase: 0,             // 0 means open; >0 = closing/opening fraction
  idlePhase: Math.random() * 6.28,
  // Tap-to-walk path
  path: null,                // [[x,z], ...] world-space waypoints, or null
  pathIdx: 0,                // index of next waypoint to reach
  pendingTap: null,          // {obj} — interactable to onTap() when path ends
  // Idle turn-to: lets the goose face an object before reacting.
  turnTo: null,              // { tx, tz, t, done } — see animate loop
};
goose.obj.position.set(goose.x, 0, goose.z);
goose.obj.visible = false;       // goose removed — model kept in graph as dead state
scene.add(goose.obj);
window.goose = goose;
markNoFade(goose.obj);
markNoFade(room);

// ============================================================
//  ROOM CONTENTS ARCHIVE
//  All furniture, plushies, decor, drawings, and clutter live below.
//  Flip the gate to `if (true)` to restore the populated room, or
//  extract individual blocks back to top-level as you re-introduce them.
// ============================================================
if (false) {
// ============================================================
//  Bunk bed (along left wall)
// ============================================================
const bunkBed = new THREE.Group();
{
  const bedW = 1.0;         // x extent
  const bedL = 2.4;         // z extent (length) — kid-sized
  const lowerY = 0.55;
  const upperY = 1.45;
  // Tuck snug into the back-left corner.
  const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
  const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
  const woodMat = mat(PAL.bedWhite, { roughness: 0.7 });

  function frameSlab(w, h, d, color = PAL.bedWhite) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, { roughness: 0.7 }));
  }

  // Lower mattress
  const lowerMat = frameSlab(bedW - 0.1, 0.15, bedL - 0.1, PAL.pinkSheet);
  lowerMat.position.set(bedX, lowerY, bedZ);
  lowerMat.castShadow = true; lowerMat.receiveShadow = true;
  bunkBed.add(lowerMat);

  // Upper mattress
  const upperMat = frameSlab(bedW - 0.1, 0.15, bedL - 0.1, PAL.bedAccent);
  upperMat.position.set(bedX, upperY, bedZ);
  upperMat.castShadow = true; upperMat.receiveShadow = true;
  bunkBed.add(upperMat);

  // Posts
  const postPositions = [
    [bedX - bedW / 2 + 0.05, bedZ - bedL / 2 + 0.05],
    [bedX - bedW / 2 + 0.05, bedZ + bedL / 2 - 0.05],
    [bedX + bedW / 2 - 0.05, bedZ - bedL / 2 + 0.05],
    [bedX + bedW / 2 - 0.05, bedZ + bedL / 2 - 0.05],
  ];
  postPositions.forEach(([x, z]) => {
    const post = frameSlab(0.08, 2.0, 0.08);
    post.position.set(x, 1.0, z);
    post.castShadow = true; post.receiveShadow = true;
    bunkBed.add(post);
  });

  // Upper guard rail (long side facing room)
  const rail = frameSlab(0.05, 0.4, bedL - 0.05);
  rail.position.set(bedX + bedW / 2 - 0.05, upperY + 0.4, bedZ);
  rail.castShadow = true;
  bunkBed.add(rail);
  // Rail slats (vertical)
  for (let i = 0; i < 7; i++) {
    const slat = frameSlab(0.04, 0.36, 0.04);
    slat.position.set(bedX + bedW / 2 - 0.05, upperY + 0.4, bedZ - bedL / 2 + 0.2 + i * (bedL - 0.4) / 6);
    slat.castShadow = true;
    bunkBed.add(slat);
  }
  // Bottom side rails for lower
  const lowerRailFront = frameSlab(0.05, 0.18, bedL - 0.05);
  lowerRailFront.position.set(bedX + bedW / 2 - 0.05, lowerY - 0.07, bedZ);
  bunkBed.add(lowerRailFront);
  const lowerRailBack = lowerRailFront.clone();
  lowerRailBack.position.x = bedX - bedW / 2 + 0.05;
  bunkBed.add(lowerRailBack);

  // Headboard panel at the back of the lower bed
  const headboard = frameSlab(bedW, 0.7, 0.05);
  headboard.position.set(bedX, lowerY + 0.25, bedZ - bedL / 2 - 0.02);
  headboard.castShadow = true;
  bunkBed.add(headboard);

  // Ladder on the south (front) end of the loft bed — vertical, two parallel rails
  // with horizontal rungs between them, attached to the bed's short end.
  const ladderRailMat = mat(PAL.bedWhite, { roughness: 0.7 });
  const ladderTopY = upperY + 0.45;
  const ladderZ = bedZ + bedL / 2 + 0.08; // just in front of the bed
  const ladderRailHalfX = 0.22;
  for (const dx of [-ladderRailHalfX, ladderRailHalfX]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, ladderTopY, 0.05),
      ladderRailMat,
    );
    rail.position.set(bedX + dx, ladderTopY / 2, ladderZ);
    rail.castShadow = true;
    bunkBed.add(rail);
  }
  // Horizontal rungs between rails
  const rungSpacing = 0.30;
  const numRungs = 4;
  for (let i = 0; i < numRungs; i++) {
    const rung = new THREE.Mesh(
      new THREE.BoxGeometry(ladderRailHalfX * 2 + 0.05, 0.04, 0.04),
      ladderRailMat,
    );
    rung.position.set(bedX, 0.25 + i * rungSpacing, ladderZ);
    rung.castShadow = true;
    bunkBed.add(rung);
  }

  // Pink blanket bunched on lower bed — also an INTERACTABLE (lift to reveal letter)
  const blanket = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const lump = new THREE.Mesh(
      new THREE.SphereGeometry(0.18 + Math.random() * 0.06, 10, 8),
      mat(PAL.blanketPink, { roughness: 0.95 }),
    );
    lump.scale.set(1.4, 0.7, 1.0);
    lump.position.set(
      (Math.random() - 0.5) * 0.3,
      0.08 + Math.random() * 0.04,
      (Math.random() - 0.5) * 0.5,
    );
    lump.castShadow = true; lump.receiveShadow = true;
    blanket.add(lump);
  }
  blanket.position.set(bedX, lowerY + 0.12, bedZ + 0.4);
  bunkBed.add(blanket);

  // Hidden letter under the blanket
  const letterE = buildLetter('E', 'E');
  letterE.position.set(bedX, lowerY + 0.13, bedZ + 0.45);
  letterE.visible = false;
  bunkBed.add(letterE);
  registerHidden(blanket, letterE, 'lift', { label: 'Filt' });

  // Rainbow hedgehog plush — INTERACTABLE (move to reveal letter L)
  const hedgehog = buildHedgehog();
  hedgehog.position.set(bedX, lowerY + 0.29, bedZ - bedL / 2 + 0.45);
  bunkBed.add(hedgehog);
  const letterL1 = buildLetter('L1', 'L');
  letterL1.position.set(bedX, lowerY + 0.13, bedZ - bedL / 2 + 0.45);
  letterL1.visible = false;
  bunkBed.add(letterL1);
  registerHidden(hedgehog, letterL1, 'hop', { label: 'Igelkott' });

  // Single cardboard box on the floor at the foot of the bed — holds letter N.
  {
    const bx = bedX + bedW / 2 + 0.35;
    const by = 0.175;
    const bz = bedZ + bedL / 2 + 0.25;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.35, 0.5),
      mat(PAL.cardBoard, { roughness: 0.9 }),
    );
    box.position.set(bx, by, bz);
    box.castShadow = true; box.receiveShadow = true;
    bunkBed.add(box);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.04, 0.5),
      mat(PAL.cardBoard, { roughness: 0.9 }),
    );
    lid.position.set(bx, by + 0.19, bz);
    lid.castShadow = true;
    bunkBed.add(lid);
    const letterN = buildLetter('N', 'N');
    letterN.position.set(bx, by + 0.30, bz);
    letterN.visible = false;
    bunkBed.add(letterN);
    registerHidden(lid, letterN, 'flipLid', { label: 'Låda', lidAxis: 'z' });
  }

  // Candle on the lower rail
  const c1 = buildCandle(PAL.candle);
  c1.position.set(bedX + bedW / 2 - 0.15, lowerY + 0.1, bedZ - bedL / 2 + 0.3);
  bunkBed.add(c1);
  registerCandle(c1);
}
scene.add(bunkBed);

// ============================================================
//  Rainbow hedgehog plush
// ============================================================
function buildHedgehog() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 14, 12),
    mat(PAL.hedgehog, { roughness: 1.0 }),
  );
  body.scale.set(1.1, 0.95, 1.1);
  body.castShadow = true;
  g.add(body);
  // Rainbow spikes
  for (let i = 0; i < 28; i++) {
    const c = PAL.rainbow[i % PAL.rainbow.length];
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.12, 6),
      mat(c, { roughness: 1.0 }),
    );
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.55 + 0.1;
    const r = 0.22;
    spike.position.set(
      Math.cos(theta) * Math.sin(phi) * r,
      Math.cos(phi) * r * 0.9,
      Math.sin(theta) * Math.sin(phi) * r,
    );
    spike.lookAt(spike.position.x * 3, spike.position.y * 3 + 0.2, spike.position.z * 3);
    spike.rotateX(Math.PI / 2);
    spike.castShadow = true;
    g.add(spike);
  }
  // Face (small snout)
  const snout = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 10),
    mat(0xfffaf2, { roughness: 0.95 }),
  );
  snout.position.set(0, -0.02, 0.21);
  snout.scale.set(1, 0.9, 0.9);
  snout.castShadow = true;
  g.add(snout);
  // Eyes
  for (const x of [-0.06, 0.06]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 8, 6),
      mat(0x2a1f1c),
    );
    eye.position.set(x, 0.04, 0.27);
    g.add(eye);
  }
  // Nose
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 6),
    mat(0x3a2e2a),
  );
  nose.position.set(0, -0.02, 0.32);
  g.add(nose);
  return g;
}

// ============================================================
//  Pine shelf / wardrobe (right wall)
// ============================================================
window.__pineDebug = window.__pineDebug || [];
window.__pineDebug.push('ENTER pineShelfFront block');
const pineShelf = new THREE.Group();
pineShelf.name = 'pineShelfFront';
{
  window.__pineDebug.push('inside-block-start');
  // Oriented with long side parallel to the right wall:
  //   sd = depth into room (x-axis), sw = length along wall (z-axis), sh = height
  const sd = 0.45, sw = 1.6, sh = 1.85;
  const sx = ROOM.w / 2 - sd / 2 - 0.04;   // back against right wall
  const sz = 0.2;                          // centered along the wall
  const woodMat = mat(PAL.wood, { roughness: 0.85 });

  // End panels — at the two ends of the shelf along z
  for (const dz of [-sw / 2, sw / 2]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(sd, sh, 0.05), woodMat);
    side.position.set(sx, sh / 2, sz + dz);
    side.castShadow = true; side.receiveShadow = true;
    pineShelf.add(side);
  }
  // Back panel — against the right wall (+x face)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.03, sh, sw), woodMat);
  back.position.set(sx + sd / 2 - 0.015, sh / 2, sz);
  pineShelf.add(back);
  // Vertical divider — splits cubbies into two halves along z
  const divider = new THREE.Mesh(new THREE.BoxGeometry(sd - 0.03, sh, 0.04), woodMat);
  divider.position.set(sx, sh / 2, sz);
  pineShelf.add(divider);
  // Horizontal shelves — span full sw
  const shelfYs = [0.04, 0.55, 1.05, 1.55, 1.83];
  shelfYs.forEach(y => {
    const sh1 = new THREE.Mesh(new THREE.BoxGeometry(sd - 0.03, 0.03, sw - 0.05), woodMat);
    sh1.position.set(sx, y, sz);
    sh1.castShadow = true; sh1.receiveShadow = true;
    pineShelf.add(sh1);
  });

  // Bottom cabinet door — covers the FRONT face of the lower-left cubby.
  // Hinge is at the +z end of the lower cubby; door swings outward (-x direction).
  const doorH = 0.46;
  const doorW = (sw / 2) - 0.05;            // length along z of the door
  const cubbyMidZ = sz - sw / 4;            // center of left cubby in z
  const doorPivot = new THREE.Group();
  // Hinge at the z-edge nearest to room front (z+)
  doorPivot.position.set(sx - sd / 2 + 0.02, 0.27, cubbyMidZ + doorW / 2);
  pineShelf.add(doorPivot);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, doorH, doorW), woodMat);
  door.position.set(0, 0, -doorW / 2);      // door extends from hinge toward -z
  door.castShadow = true;
  doorPivot.add(door);
  // Handle on the door
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 8, 6),
    mat(0xcfa370, { roughness: 0.6 }),
  );
  handle.position.set(-0.025, 0, -doorW + 0.07);
  doorPivot.add(handle);
  window.__pineDebug.push('before letterR');
  // Letter R hidden inside the cabinet
  const letterR = buildLetter('R', 'R');
  letterR.position.set(sx, 0.27, cubbyMidZ);
  letterR.visible = false;
  pineShelf.add(letterR);
  registerHidden(doorPivot, letterR, 'door', { label: 'Skåpsdörr' });
  window.__pineDebug.push('after letterR');

  window.__pineDebug.push('before drawer-bank');
  // Drawer bank on the right (front-z) cubby bottom — two stacked drawers
  // that pull straight out toward the room.
  {
    const dCubbyMidZ = sz + sw / 4;            // center of right cubby in z
    const dWidth     = (sw / 2) - 0.06;        // length of drawer front along z
    const dHeight    = 0.21;                    // each drawer's face height
    const dFaceX     = sx - sd / 2 + 0.02;     // flush with shelf front
    const dThick     = 0.035;
    const debugMat   = mat(0xff0000, { roughness: 0.6 });
    const pullMat    = mat(0xcfa370, { roughness: 0.6 });
    // Lower drawer at y≈0.16, upper at y≈0.40 — fits inside cubby 0.04→0.55.
    for (const dy of [0.16, 0.40]) {
      const front = new THREE.Mesh(
        new THREE.BoxGeometry(dThick, dHeight, dWidth),
        debugMat,
      );
      front.position.set(dFaceX, dy, dCubbyMidZ);
      front.castShadow = true; front.receiveShadow = true;
      pineShelf.add(front);
      // Horizontal bar pull centered on the drawer
      const pull = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.018, 0.14),
        pullMat,
      );
      pull.position.set(dFaceX - dThick / 2 - 0.011, dy, dCubbyMidZ);
      pull.castShadow = true;
      pineShelf.add(pull);
      // Two small stand-off posts so the pull reads as a bar handle
      for (const pz of [-0.05, 0.05]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.012, 0.012, 0.012),
          pullMat,
        );
        post.position.set(dFaceX - dThick / 2 - 0.004, dy, dCubbyMidZ + pz);
        pineShelf.add(post);
      }
    }
  }
  window.__pineDebug.push('after drawer-bank kids=' + pineShelf.children.length);

  // Pikachu plush sitting on top of the desk like a desk-friend, near the
  // left edge so the back wall pegboard isn't blocked.
  const pikachu = buildPikachu();
  pikachu.scale.setScalar(0.75);
  pikachu.position.set(1.40, 0.78 + 0.18, -2.65);
  pikachu.rotation.y = 0.3;
  scene.add(pikachu);
  const letterI = buildLetter('I', 'I');
  letterI.position.set(1.40, 0.78 + 0.05, -2.65);
  letterI.visible = false;
  scene.add(letterI);
  registerHidden(pikachu, letterI, 'wiggle', { label: 'Pikachu' });

  // Books on the middle shelf (right cubby), spaced along z
  const bookColors = [0xd97b8a, 0x8aa68a, 0xe9c46a, 0xc28dba, 0x9ac4e9];
  for (let i = 0; i < 5; i++) {
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.22, 0.06),
      mat(bookColors[i % bookColors.length], { roughness: 0.85 }),
    );
    book.position.set(sx - 0.05, 0.69, sz + sw / 4 - 0.26 + i * 0.13);
    book.castShadow = true;
    pineShelf.add(book);
  }

  // Candle on the middle shelf (left cubby)
  const c2 = buildCandle(PAL.candleAlt);
  c2.position.set(sx - 0.05, 0.61, cubbyMidZ);
  pineShelf.add(c2);
  registerCandle(c2);

  // Small candle on the upper-mid shelf (top shelf is out of goose reach)
  const c3 = buildCandle(PAL.candle);
  c3.position.set(sx - 0.05, 1.10, sz - sw / 4);
  pineShelf.add(c3);
  registerCandle(c3);
  window.__pineDebug.push('block-end-reached');
}
window.__pineDebug.push('after-block kids=' + pineShelf.children.length);
scene.add(pineShelf);
window.__pineDebug.push('post-scene-add');

// ============================================================
//  Pikachu plush
// ============================================================
function buildPikachu() {
  const g = new THREE.Group();
  // Body (chubby round)
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    mat(PAL.pikachu, { roughness: 0.95 }),
  );
  body.scale.set(1.15, 1.0, 1.1);
  body.castShadow = true;
  g.add(body);
  // Ears — tall and pointy, clearly above the head
  for (const x of [-0.13, 0.13]) {
    const tilt = x < 0 ? 0.22 : -0.22;
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.055, 0.36, 10),
      mat(PAL.pikachu, { roughness: 0.95 }),
    );
    ear.position.set(x, 0.42, -0.02);
    ear.rotation.z = tilt;
    ear.castShadow = true;
    g.add(ear);
    // Black tip — about a third of the ear length, sitting at the top
    const tipH = 0.12;
    const earTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.034, tipH, 10),
      mat(0x2a1f1c, { roughness: 0.95 }),
    );
    // Place tip along the ear's local +Y, offset upward in world by the
    // ear half + tip half (minus a tiny overlap to hide the seam).
    const tipLift = 0.18 + tipH / 2 - 0.012;
    earTip.position.set(x + Math.sin(tilt) * tipLift, 0.42 + Math.cos(tilt) * tipLift, -0.02);
    earTip.rotation.z = tilt;
    g.add(earTip);
  }
  // Eyes
  for (const x of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 10, 8),
      mat(0x2a1f1c),
    );
    eye.position.set(x, 0.06, 0.25);
    g.add(eye);
    const eyeShine = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 6, 6),
      mat(0xffffff),
    );
    eyeShine.position.set(x + 0.01, 0.075, 0.27);
    g.add(eyeShine);
  }
  // Cheeks
  for (const x of [-0.18, 0.18]) {
    const cheek = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 6),
      mat(0xe96b6b, { roughness: 0.9 }),
    );
    cheek.position.set(x, -0.02, 0.24);
    cheek.scale.set(1, 0.85, 0.4);
    g.add(cheek);
  }
  // Smile (small box)
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.012, 0.012),
    mat(0x2a1f1c),
  );
  mouth.position.set(0, -0.05, 0.27);
  g.add(mouth);
  return g;
}

// ============================================================
//  Desk + art cart + clock (right back)
// ============================================================
{
  // Desk
  const deskMat = mat(PAL.bedWhite, { roughness: 0.7 });
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.6), deskMat);
  const dx = ROOM.w / 2 - 0.85;
  const dz = -ROOM.d / 2 + 0.4;
  deskTop.position.set(dx, 0.78, dz);
  deskTop.castShadow = true; deskTop.receiveShadow = true;
  scene.add(deskTop);
  // Desk legs
  for (const sx of [-0.7, 0.7]) {
    for (const sz of [-0.25, 0.25]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.06), deskMat);
      leg.position.set(dx + sx, 0.38, dz + sz);
      leg.castShadow = true;
      scene.add(leg);
    }
  }
  // Pegboard above desk
  const peg = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.7, 0.03),
    mat(0xfae0d5, { roughness: 0.9 }),
  );
  peg.position.set(dx, 1.55, -ROOM.d / 2 + 0.04);
  scene.add(peg);
  // Small dots on pegboard
  for (let i = 0; i < 16; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0xddc3b8));
    dot.position.set(dx - 0.55 + (i % 8) * 0.15, 1.3 + Math.floor(i / 8) * 0.25, -ROOM.d / 2 + 0.06);
    scene.add(dot);
  }
  // Art supplies on desk
  const colors = [0xd97b8a, 0x8aa68a, 0xf4d55c, 0xc28dba, 0x9ac4e9, 0xe96b6b];
  for (let i = 0; i < 6; i++) {
    const pencil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.18, 8),
      mat(colors[i], { roughness: 0.8 }),
    );
    pencil.position.set(dx - 0.5 + i * 0.05, 0.88, dz + 0.1);
    pencil.rotation.z = (i - 3) * 0.05;
    pencil.castShadow = true;
    scene.add(pencil);
  }
  // Paper sheet
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.4),
    mat(0xfffaf2, { roughness: 0.8 }),
  );
  paper.rotation.x = -Math.PI / 2;
  paper.position.set(dx + 0.3, 0.806, dz + 0.05);
  scene.add(paper);

  // Letter O hidden under the paper
  const letterO = buildLetter('O', 'O');
  letterO.position.set(dx + 0.3, 0.81, dz + 0.05);
  letterO.visible = false;
  scene.add(letterO);
  registerHidden(paper, letterO, 'paperLift', { label: 'Papper' });

  // Candle on desk
  const c4 = buildCandle(PAL.candle);
  c4.position.set(dx - 0.7, 0.81, dz + 0.18);
  scene.add(c4);
  registerCandle(c4);

  // Wall clock (above desk on back wall, right side)
  const clockBack = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 24),
    mat(0xfffaf2, { roughness: 0.7 }),
  );
  clockBack.position.set(dx + 0.55, 2.05, -ROOM.d / 2 + 0.02);
  scene.add(clockBack);
  // Clock rays / numbers
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const tick = new THREE.Mesh(
      new THREE.CircleGeometry(0.018, 8),
      mat([0xd97b8a, 0xf4d55c, 0x8aa68a, 0x9ac4e9][i % 4]),
    );
    tick.position.set(
      dx + 0.55 + Math.cos(ang) * 0.16,
      2.05 + Math.sin(ang) * 0.16,
      -ROOM.d / 2 + 0.022,
    );
    scene.add(tick);
  }
  // Hands
  const hourH = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.1, 0.005),
    mat(0x3a2e2a),
  );
  hourH.position.set(dx + 0.55, 2.085, -ROOM.d / 2 + 0.025);
  scene.add(hourH);
  const minH = new THREE.Mesh(
    new THREE.BoxGeometry(0.008, 0.16, 0.005),
    mat(0xd97b8a),
  );
  minH.position.set(dx + 0.55, 2.11, -ROOM.d / 2 + 0.026);
  minH.rotation.z = -0.6;
  scene.add(minH);
}

// ============================================================
//  Yellow art cart (tucked against right wall between bookshelf and desk)
// ============================================================
{
  const cx = 2.30;
  const cz = -1.80;
  const cartMat = mat(PAL.cartYellow, { roughness: 0.85 });
  // 3 trays
  for (let i = 0; i < 3; i++) {
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.04, 0.4),
      cartMat,
    );
    tray.position.set(cx, 0.18 + i * 0.32, cz);
    tray.castShadow = true; tray.receiveShadow = true;
    scene.add(tray);
    // Rim
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.06, 0.02),
      cartMat,
    );
    rim.position.set(cx, 0.18 + i * 0.32 + 0.03, cz - 0.19);
    scene.add(rim);
    const rim2 = rim.clone(); rim2.position.z = cz + 0.19; scene.add(rim2);
  }
  // Posts
  for (const sx of [-0.27, 0.27]) {
    for (const sz of [-0.19, 0.19]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 0.85, 8),
        cartMat,
      );
      post.position.set(cx + sx, 0.43, cz + sz);
      post.castShadow = true;
      scene.add(post);
    }
  }
  // Wheels
  for (const sx of [-0.25, 0.25]) {
    for (const sz of [-0.17, 0.17]) {
      const wheel = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 6),
        mat(0x3a2e2a, { roughness: 0.6 }),
      );
      wheel.position.set(cx + sx, 0.04, cz + sz);
      wheel.castShadow = true;
      scene.add(wheel);
    }
  }
  // Random art objects on cart
  const objs = [
    { c: 0xd97b8a, x: -0.15, z: 0 },
    { c: 0x9ac4e9, x: 0.1, z: -0.05 },
    { c: 0x8aa68a, x: 0.15, z: 0.08 },
  ];
  objs.forEach(o => {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.04, 0.08, 8),
      mat(o.c),
    );
    cup.position.set(cx + o.x, 0.86, cz + o.z);
    cup.castShadow = true;
    scene.add(cup);
  });

  // Candle on top tray
  const c5 = buildCandle(PAL.candleAlt);
  c5.position.set(cx + 0.2, 0.84, cz + 0.05);
  scene.add(c5);
  registerCandle(c5);

  // Hide L2 inside the bottom tray
  const trayLid = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.02, 0.36),
    mat(PAL.cartYellow, { roughness: 0.8 }),
  );
  trayLid.position.set(cx, 0.21, cz);
  trayLid.castShadow = true;
  scene.add(trayLid);
  const letterL2 = buildLetter('L2', 'L');
  letterL2.position.set(cx, 0.27, cz);
  letterL2.visible = false;
  scene.add(letterL2);
  registerHidden(trayLid, letterL2, 'paperLift', { label: 'Bricka' });
}

// ============================================================
//  Hello Kitty laundry basket (right front floor)
// ============================================================
{
  const lx = ROOM.w / 2 - 0.55;
  const lz = ROOM.d / 2 - 0.45;
  const basketMat = mat(PAL.helloKittyWhite, { roughness: 0.85 });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.6, 0.6),
    basketMat,
  );
  body.position.set(lx, 0.3, lz);
  body.castShadow = true; body.receiveShadow = true;
  scene.add(body);
  // Hello Kitty face (front)
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 24),
    mat(PAL.helloKittyWhite),
  );
  face.position.set(lx, 0.35, lz + 0.301);
  scene.add(face);
  // Bow
  const bow = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    mat(PAL.helloKittyPink),
  );
  bow.position.set(lx + 0.1, 0.45, lz + 0.302);
  bow.scale.set(1.4, 0.7, 0.5);
  scene.add(bow);
  // Eyes
  for (const x of [-0.06, 0.06]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat(0x2a1f1c));
    eye.position.set(lx + x, 0.37, lz + 0.304);
    scene.add(eye);
  }
  // Nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), mat(0xf4d55c));
  nose.position.set(lx, 0.34, lz + 0.305);
  scene.add(nose);

  // Pink blanket pile on top — INTERACTABLE (lift to reveal candle inside basket)
  const pile = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const lump = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 + Math.random() * 0.05, 10, 8),
      mat(PAL.blanketPink, { roughness: 0.95 }),
    );
    lump.scale.set(1.2, 0.7, 1.0);
    lump.position.set(
      (Math.random() - 0.5) * 0.4,
      Math.random() * 0.1,
      (Math.random() - 0.5) * 0.3,
    );
    lump.castShadow = true;
    pile.add(lump);
  }
  pile.position.set(lx, 0.68, lz);
  scene.add(pile);

  // Candle hidden under the blanket pile
  const c6 = buildCandle(PAL.candle);
  c6.position.set(lx + 0.1, 0.64, lz);
  c6.visible = false;
  scene.add(c6);
  registerCandle(c6);
  // Attach pile as a container that reveals candle
  registerHidden(pile, c6, 'lift', { label: 'Tvätt' });
}

// ============================================================
//  Small step stool / wood ladder (center floor) — also hides a letter
// ============================================================
{
  // Step stool sits in the alcove behind the bunk-bed footboard (back-left of the room).
  const stx = -0.65, stz = -1.75;
  const stoolMat = mat(PAL.bedWhite, { roughness: 0.8 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.3), stoolMat);
  top.position.set(stx, 0.32, stz);
  top.castShadow = true; top.receiveShadow = true;
  scene.add(top);
  for (const sx of [-0.15, 0.15]) {
    for (const sz of [-0.13, 0.13]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.04), stoolMat);
      leg.position.set(stx + sx, 0.16, stz + sz);
      leg.castShadow = true;
      scene.add(leg);
    }
  }

  // Candle on stool top
  const c7 = buildCandle(PAL.candleAlt);
  c7.position.set(stx - 0.08, 0.34, stz);
  scene.add(c7);
  registerCandle(c7);

  // Slippers/box under stool
  const slipBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.22),
    mat(PAL.pinkSheet, { roughness: 0.85 }),
  );
  slipBox.position.set(stx + 0.1, 0.04, stz);
  scene.add(slipBox);
}

// ============================================================
//  Picture frames / decorations on right wall
// ============================================================
{
  const rwx = ROOM.w / 2 - 0.02;
  const frameMat = mat(0xfffaf2, { roughness: 0.7 });
  for (let i = 0; i < 2; i++) {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.3, 0.4),
      frameMat,
    );
    frame.position.set(rwx - 0.01, 1.7 + i * 0.5, -1.5 + i * 0.6);
    scene.add(frame);
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.22, 0.32),
      mat([0xf6cfcb, 0x9ac4e9][i]),
    );
    inner.position.set(rwx - 0.025, 1.7 + i * 0.5, -1.5 + i * 0.6);
    scene.add(inner);
  }
}

// Candle near desk floor area (8th candle)
{
  const c8 = buildCandle(PAL.candle);
  c8.position.set(0.6, 0, -2.5);
  scene.add(c8);
  registerCandle(c8);
}

// ============================================================
//  Clutter — toys, drawings, plushies, books, etc.
//  Pure decoration to make the room feel lived-in (UGG vibe).
// ============================================================
{
  // --- Small white shag rug under the lower-bunk / desk area ---
  // Photo 1: small fluffy white rectangular rug on the wood floor under the bunk.
  {
    const sx = -ROOM.w / 2 + 0.85, sz = -0.30;
    // Soft pile base (slightly raised)
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(1.10, 0.85),
      mat(0xfaf5ec, { roughness: 0.98 }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(sx, 0.011, sz);
    base.receiveShadow = true;
    scene.add(base);
    // Sprinkle small fuzzy puffs to suggest shag texture
    for (let i = 0; i < 36; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.025 + Math.random() * 0.015, 6, 5),
        mat(0xfffaf2, { roughness: 0.98 }),
      );
      const px = sx + (Math.random() - 0.5) * 1.00;
      const pz = sz + (Math.random() - 0.5) * 0.75;
      puff.position.set(px, 0.022, pz);
      puff.scale.set(1.0, 0.5, 1.0);
      scene.add(puff);
    }
  }

  // --- Round raccoon rug (the signature floor piece in Ellinor's real room) ---
  const RUG_X = -0.3, RUG_Z = 0.6;
  const rugBase = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 40),
    mat(0xfaf6ee, { roughness: 0.98 }),
  );
  rugBase.rotation.x = -Math.PI / 2;
  rugBase.position.set(RUG_X, 0.012, RUG_Z);
  rugBase.receiveShadow = true;
  scene.add(rugBase);
  // Raccoon face — gray oval centered on rug
  const rugFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 32),
    mat(0xbfb0a0, { roughness: 0.98 }),
  );
  rugFace.rotation.x = -Math.PI / 2;
  rugFace.position.set(RUG_X, 0.014, RUG_Z);
  rugFace.scale.set(1.0, 1.0, 0.85);
  scene.add(rugFace);
  // Pink nose triangle
  const rugNose = new THREE.Mesh(
    new THREE.CircleGeometry(0.07, 3),
    mat(0xf6cfcb, { roughness: 0.95 }),
  );
  rugNose.rotation.x = -Math.PI / 2;
  rugNose.rotation.z = Math.PI;
  rugNose.position.set(RUG_X, 0.016, RUG_Z + 0.05);
  scene.add(rugNose);
  // Eyes (white patches with dark dots — the raccoon mask reads from above)
  for (const sx of [-0.18, 0.18]) {
    const eyePatch = new THREE.Mesh(
      new THREE.CircleGeometry(0.10, 18),
      mat(0x3a2e2a, { roughness: 0.98 }),
    );
    eyePatch.rotation.x = -Math.PI / 2;
    eyePatch.position.set(RUG_X + sx, 0.015, RUG_Z - 0.05);
    eyePatch.scale.set(1.0, 1.0, 0.75);
    scene.add(eyePatch);
    const eyeDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.035, 14),
      mat(0xfffaf2, { roughness: 0.95 }),
    );
    eyeDot.rotation.x = -Math.PI / 2;
    eyeDot.position.set(RUG_X + sx, 0.016, RUG_Z - 0.05);
    scene.add(eyeDot);
  }
  // Ears (dark gray semicircles up top)
  for (const sx of [-0.34, 0.34]) {
    const ear = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 18),
      mat(0x6a5a52, { roughness: 0.98 }),
    );
    ear.rotation.x = -Math.PI / 2;
    ear.position.set(RUG_X + sx, 0.015, RUG_Z - 0.32);
    ear.scale.set(1.0, 1.0, 0.8);
    scene.add(ear);
  }
  // Striped tail wrapping around the rug edge (alternating dark/light arcs)
  for (let i = 0; i < 6; i++) {
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.95, 24, 1, (i / 6) * Math.PI * 2, (Math.PI * 2) / 6 - 0.05),
      mat(i % 2 === 0 ? 0x6a5a52 : 0xfaf6ee, { roughness: 0.98 }),
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.set(RUG_X, 0.013, RUG_Z);
    scene.add(arc);
  }

  // (Removed: blue swivel chair and floor pouf — center of room kept clear per user feedback)

  // --- Teddy bear on lower bunk pillow side ---
  {
    const tg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), mat(0xc8a878, { roughness: 0.95 }));
    body.scale.set(1.0, 1.05, 0.9);
    body.castShadow = true;
    tg.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), mat(0xc8a878, { roughness: 0.95 }));
    head.position.set(0, 0.18, 0.05);
    head.castShadow = true;
    tg.add(head);
    for (const x of [-0.09, 0.09]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), mat(0xc8a878));
      ear.position.set(x, 0.27, 0.05);
      tg.add(ear);
    }
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(0xe8d2b0));
    snout.position.set(0, 0.16, 0.16);
    tg.add(snout);
    for (const x of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0x2a1f1c));
      eye.position.set(x, 0.21, 0.15);
      tg.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), mat(0x2a1f1c));
    nose.position.set(0, 0.17, 0.2);
    tg.add(nose);
    tg.position.set(-2.0, 0.79, -1.2);
    tg.rotation.y = 0.4;
    scene.add(tg);
  }

  // --- Unicorn plush on the upper bunk ---
  {
    const u = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), mat(0xfaf0e6));
    body.scale.set(1.2, 0.85, 1.0);
    body.castShadow = true;
    u.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat(0xfaf0e6));
    head.position.set(0.18, 0.12, 0);
    u.add(head);
    // Rainbow mane
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(PAL.rainbow[i % PAL.rainbow.length]));
      m.position.set(0.06 + i * 0.025, 0.13 + Math.sin(i) * 0.02, 0.08 * (i % 2 === 0 ? 1 : -1));
      m.scale.set(0.8, 0.6, 0.6);
      u.add(m);
    }
    // Horn
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 8), mat(0xf4d55c));
    horn.position.set(0.22, 0.22, 0);
    horn.rotation.z = -0.2;
    u.add(horn);
    // Eyes
    for (const z of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0x2a1f1c));
      eye.position.set(0.27, 0.13, z);
      u.add(eye);
    }
    u.position.set(-2.05, 1.69, 0.9);
    u.rotation.y = -0.3;
    scene.add(u);
  }

  // --- Wooden toy car (on floor near the front, beside the bunk) ---
  {
    const car = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.18), mat(0xd97b8a));
    chassis.position.y = 0.08;
    chassis.castShadow = true;
    car.add(chassis);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.16), mat(0x9ac4e9));
    cabin.position.set(-0.02, 0.17, 0);
    car.add(cabin);
    for (const x of [-0.12, 0.12]) {
      for (const z of [-0.09, 0.09]) {
        const w = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12),
          mat(0x2a1f1c),
        );
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.045, z);
        car.add(w);
      }
    }
    car.position.set(-1.3, 0, 2.5);
    car.rotation.y = 0.6;
    scene.add(car);
  }

  // (Removed: floor building blocks tower — center of room kept clear per user feedback)

  // --- Scattered drawings on floor (paper sheets with crayon scribbles) ---
  // Placed clear of the rug (which spans ~(0.1, 0.4) radius 1.3) to avoid z-fight.
  {
    const drawingSpots = [
      { x: 1.6,  z: 1.6  },
      { x: -1.0, z: 2.2  },
      { x: 1.4,  z: 2.4  },
      { x: -1.6, z: 2.1  },
    ];
    drawingSpots.forEach((s, i) => {
      const draw = new THREE.Mesh(
        new THREE.PlaneGeometry(0.28, 0.36),
        mat(0xfffaf2, { roughness: 0.95 }),
      );
      draw.rotation.x = -Math.PI / 2;
      draw.rotation.z = i * 0.55;
      draw.position.set(s.x, 0.018, s.z);
      scene.add(draw);
      for (let j = 0; j < 3; j++) {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(0.18 - j * 0.04, 0.006, 0.012),
          mat([0xd97b8a, 0x9ac4e9, 0x8aa68a, 0xf4d55c][(i + j) % 4]),
        );
        line.rotation.x = -Math.PI / 2;
        line.rotation.z = i * 0.55 + j * 0.4;
        line.position.set(s.x, 0.022, s.z + (j - 1) * 0.06);
        scene.add(line);
      }
    });
  }

  // --- Crayons scattered ---
  {
    const crayonColors = [0xe96b6b, 0xf4d55c, 0x9ac4e9, 0x8aa68a, 0xc28dba, 0xf4a261];
    for (let i = 0; i < 6; i++) {
      const cr = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.013, 0.12, 8),
        mat(crayonColors[i]),
      );
      cr.rotation.z = Math.PI / 2 + (i % 2) * 0.4;
      cr.rotation.y = i * 0.9;
      cr.position.set(-0.3 + (i % 3) * 0.12, 0.015, 0.4 + Math.floor(i / 3) * 0.18);
      cr.castShadow = true;
      scene.add(cr);
    }
  }

  // --- Bedside table lamp on desk ---
  {
    const lampX = 1.3, lampZ = -2.95;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.05, 14),
      mat(PAL.bedWhite),
    );
    base.position.set(lampX, 0.83, lampZ);
    base.castShadow = true;
    scene.add(base);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8),
      mat(0xbfb0a0),
    );
    stem.position.set(lampX, 0.94, lampZ);
    scene.add(stem);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.13, 16, 1, true),
      mat(PAL.pinkSheet, { side: THREE.DoubleSide }),
    );
    shade.position.set(lampX, 1.1, lampZ);
    shade.castShadow = true;
    scene.add(shade);
    // Warm glow
    const lampLight = new THREE.PointLight(0xfff0d0, 0.5, 2.5, 2);
    lampLight.position.set(lampX, 1.1, lampZ);
    scene.add(lampLight);
  }

  // --- Storybook on the floor ---
  {
    const book = new THREE.Group();
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.025, 0.24),
      mat(0xd97b8a, { roughness: 0.85 }),
    );
    book.add(back);
    // Open page
    const page = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.22),
      mat(0xfffaf2),
    );
    page.rotation.x = -Math.PI / 2;
    page.position.y = 0.014;
    book.add(page);
    // Spine line
    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.027, 0.24),
      mat(0xb35a6a),
    );
    book.add(spine);
    book.position.set(-1.0, 0.013, 2.1);
    book.rotation.y = 0.35;
    book.castShadow = true;
    scene.add(book);
  }

  // --- Hairbrush on desk ---
  {
    const dx = ROOM.w / 2 - 0.85;
    const dz = -ROOM.d / 2 + 0.4;
    const brush = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.03, 0.05),
      mat(0xc28dba),
    );
    brush.add(handle);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.05, 0.08),
      mat(0xc28dba),
    );
    head.position.set(0.13, 0, 0);
    brush.add(head);
    // Bristles
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6),
        mat(0xfffaf2),
      );
      b.position.set(0.08 + (i % 4) * 0.02, -0.04, -0.03 + Math.floor(i / 4) * 0.06);
      brush.add(b);
    }
    brush.position.set(dx + 0.55, 0.825, dz - 0.1);
    brush.rotation.y = -0.5;
    brush.castShadow = true;
    scene.add(brush);
  }

  // --- Pennant flag banner across the back wall ---
  {
    const bannerY = 2.35;
    const cordMat = mat(0x8aa68a, { roughness: 0.8 });
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 2.6, 6),
      cordMat,
    );
    cord.rotation.z = Math.PI / 2;
    cord.position.set(0, bannerY, -ROOM.d / 2 + 0.05);
    scene.add(cord);
    const colors = [0xd97b8a, 0xf4d55c, 0x9ac4e9, 0x8aa68a, 0xc28dba, 0xf4a8b8, 0xe9c46a];
    for (let i = 0; i < 7; i++) {
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.18, 4),
        mat(colors[i]),
      );
      flag.rotation.x = Math.PI;
      flag.rotation.y = Math.PI / 4;
      flag.position.set(-1.2 + i * 0.4, bannerY - 0.1, -ROOM.d / 2 + 0.06);
      scene.add(flag);
    }
  }

  // --- Wall poster on the back wall between bunk bed and window ---
  {
    const w = 0.32, h = 0.42;
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      mat(0xfae0d5, { roughness: 0.95 }),
    );
    poster.position.set(-1.30, 1.65, -ROOM.d / 2 + 0.025);
    scene.add(poster);
    const border = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.01),
      mat(0xfffaf2),
    );
    border.position.set(-1.30, 1.65, -ROOM.d / 2 + 0.018);
    scene.add(border);
  }

  // --- Cluster of child drawings + sun clock on back wall (right of window) ---
  // Photo 1: a small grid of taped-up colorful drawings + a white sun-ray
  // clock fills the back wall to the right of the window.
  {
    const wallZ = -ROOM.d / 2 + 0.03;
    // Sun-ray clock (cream-white face with 10 short rays)
    const cx = 2.10, cy = 2.05;
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.012, 22),
      mat(0xfffaf2, { roughness: 0.85 }),
    );
    face.rotation.x = Math.PI / 2;
    face.position.set(cx, cy, wallZ);
    scene.add(face);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const ray = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.05, 0.006),
        mat(0xfffaf2, { roughness: 0.85 }),
      );
      ray.position.set(cx + Math.cos(a) * 0.16, cy + Math.sin(a) * 0.16, wallZ + 0.008);
      ray.rotation.z = a + Math.PI / 2;
      scene.add(ray);
    }
    // Tiny clock hands
    const hourHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.05, 0.005),
      mat(0x3a2e2a),
    );
    hourHand.position.set(cx, cy + 0.022, wallZ + 0.012);
    scene.add(hourHand);
    const minHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.07, 0.005),
      mat(0x3a2e2a),
    );
    minHand.position.set(cx + 0.018, cy, wallZ + 0.012);
    minHand.rotation.z = -Math.PI / 3;
    scene.add(minHand);

    // 6 small kid drawings around/below the clock
    const drawings = [
      { x: 1.55, y: 1.85, w: 0.18, h: 0.22, color: 0xfff8e6, accent: 0xe96b6b },
      { x: 1.55, y: 2.20, w: 0.16, h: 0.18, color: 0xfffaf2, accent: 0x9ac4e9 },
      { x: 1.80, y: 1.60, w: 0.20, h: 0.18, color: 0xfff8e6, accent: 0x8aa68a },
      { x: 2.40, y: 1.70, w: 0.18, h: 0.22, color: 0xfffaf2, accent: 0xf4d55c },
      { x: 2.45, y: 2.30, w: 0.16, h: 0.20, color: 0xfff8e6, accent: 0xc28dba },
      { x: 1.95, y: 1.25, w: 0.22, h: 0.18, color: 0xfffaf2, accent: 0xe96b6b },
    ];
    for (const d of drawings) {
      const paper = new THREE.Mesh(
        new THREE.BoxGeometry(d.w, d.h, 0.008),
        mat(d.color, { roughness: 0.95 }),
      );
      paper.position.set(d.x, d.y, wallZ + 0.012);
      paper.rotation.z = (Math.random() - 0.5) * 0.08;
      scene.add(paper);
      // 2-3 scribble strokes
      for (let i = 0; i < 3; i++) {
        const scr = new THREE.Mesh(
          new THREE.BoxGeometry(0.04 + Math.random() * 0.06, 0.012, 0.004),
          mat(d.accent, { roughness: 0.9 }),
        );
        scr.position.set(
          d.x + (Math.random() - 0.5) * (d.w - 0.06),
          d.y - d.h / 2 + 0.04 + i * (d.h / 3.5),
          wallZ + 0.017,
        );
        scr.rotation.z = (Math.random() - 0.5) * 0.4;
        scene.add(scr);
      }
      // Tape strip across the top
      const tape = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.018, 0.003),
        mat(0xeeeeea, { roughness: 0.7, transparent: true, opacity: 0.85 }),
      );
      tape.position.set(d.x, d.y + d.h / 2 - 0.01, wallZ + 0.020);
      scene.add(tape);
    }
  }

  // --- Floor cushion (square) — tucked beside the rug on the front-left ---
  {
    const cushion = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.42),
      mat(0xb8e5c4, { roughness: 0.95 }),
    );
    cushion.position.set(-0.4, 0.07, 1.5);
    cushion.castShadow = true; cushion.receiveShadow = true;
    scene.add(cushion);
    const btn = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      mat(0xfffaf2),
    );
    btn.position.set(-0.4, 0.13, 1.5);
    scene.add(btn);
  }

  // --- Bunny slippers under bunk bed ---
  {
    for (const offset of [-0.12, 0.12]) {
      const s = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.06, 0.22),
        mat(0xf6cfcb, { roughness: 0.95 }),
      );
      body.position.y = 0.03;
      s.add(body);
      const toe = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 12, 10),
        mat(0xf6cfcb),
      );
      toe.position.set(0, 0.075, 0.09);
      s.add(toe);
      // Bunny ears
      for (const ex of [-0.025, 0.025]) {
        const ear = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, 0.05, 0.012),
          mat(0xfaf6ee),
        );
        ear.position.set(ex, 0.09, 0.1);
        ear.rotation.x = -0.2;
        s.add(ear);
      }
      s.position.set(-1.85, 0, 1.6 + offset);
      s.rotation.y = 0.1 + offset * 0.2;
      s.castShadow = true;
      scene.add(s);
    }
  }

  // --- Globe sitting on top of the pine shelf ---
  {
    const gx = 2.30;
    const gz = 0.40;
    const gy = 1.85; // top of pine shelf
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.04, 10),
      mat(0xb88a5a),
    );
    stand.position.set(gx, gy + 0.02, gz);
    scene.add(stand);
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.008, 6, 16, Math.PI),
      mat(0xcfa370),
    );
    arc.position.set(gx, gy + 0.13, gz);
    arc.rotation.x = Math.PI / 2;
    scene.add(arc);
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 16, 12),
      mat(0x9ac4e9, { roughness: 0.6 }),
    );
    globe.position.set(gx, gy + 0.12, gz);
    globe.castShadow = true;
    scene.add(globe);
    for (let i = 0; i < 4; i++) {
      const cont = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 6),
        mat(0xb8c89a),
      );
      const a = i * 1.6;
      cont.position.set(
        gx + Math.cos(a) * 0.09,
        gy + 0.12 + Math.sin(i) * 0.04,
        gz + Math.sin(a) * 0.09,
      );
      cont.scale.set(0.9, 0.5, 0.9);
      scene.add(cont);
    }
  }

  // --- Plushie pile (front-left corner) — mimics the heap of stuffed toys in the real room ---
  {
    const px = -ROOM.w / 2 + 0.55;
    const pz = ROOM.d / 2 - 0.55;
    const plushColors = [0xf4c8c8, 0xf4d55c, 0xc28dba, 0xfaf6ee, 0xe9c46a, 0xf4a261];
    // 6 squishy bodies clustered around (px, pz) at slightly different heights
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const r = 0.08 + (i % 2) * 0.12;
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.13 + (i % 3) * 0.03, 12, 10),
        mat(plushColors[i % plushColors.length], { roughness: 1.0 }),
      );
      body.scale.set(1.05, 0.9, 1.05);
      body.position.set(
        px + Math.cos(a) * r,
        0.13 + (i % 3) * 0.04,
        pz + Math.sin(a) * r,
      );
      body.castShadow = true; body.receiveShadow = true;
      scene.add(body);
      // Tiny ear blob on top of every other plushie
      if (i % 2 === 0) {
        const ear = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 8, 6),
          mat(plushColors[i % plushColors.length], { roughness: 1.0 }),
        );
        ear.position.set(
          px + Math.cos(a) * r - 0.05,
          0.27 + (i % 3) * 0.04,
          pz + Math.sin(a) * r - 0.03,
        );
        scene.add(ear);
      }
    }
  }

  // --- Beanbag chair (front-right of room) ---
  {
    const bx = ROOM.w / 2 - 1.75;
    const bz = ROOM.d / 2 - 0.5;
    const bag = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 14, 12),
      mat(0xf4d55c, { roughness: 0.95 }),
    );
    bag.position.set(bx, 0.34, bz);
    bag.scale.set(1.05, 0.85, 1.05);
    bag.castShadow = true; bag.receiveShadow = true;
    scene.add(bag);
    // Indent on top
    const indent = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 8),
      mat(0xe9c46a, { roughness: 0.95 }),
    );
    indent.position.set(bx, 0.60, bz);
    indent.scale.set(1.0, 0.4, 1.0);
    scene.add(indent);
  }

  // --- Cute stickers on the side wall (left) — small colorful dots ---
  {
    for (let i = 0; i < 18; i++) {
      const sticker = new THREE.Mesh(
        new THREE.CircleGeometry(0.04 + Math.random() * 0.02, 12),
        mat([0xd97b8a, 0xf4d55c, 0x9ac4e9, 0x8aa68a, 0xc28dba][i % 5]),
      );
      sticker.rotation.y = Math.PI / 2;
      sticker.position.set(
        -ROOM.w / 2 + 0.03,
        1.0 + Math.random() * 1.1,
        -1.7 + Math.random() * 3.0,
      );
      scene.add(sticker);
    }
  }

  // --- White 3-drawer dresser (front-left wall, between bunk and door) ---
  {
    const dx = -ROOM.w / 2 + 0.32;
    const dz = 1.65;
    const dresserGroup = new THREE.Group();
    const dresserMat = mat(PAL.bedWhite, { roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.95), dresserMat);
    body.position.set(0, 0.43, 0);
    body.castShadow = true; body.receiveShadow = true;
    dresserGroup.add(body);
    // Drawer fronts + knobs
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.24, 0.87),
        mat(0xfffaf2, { roughness: 0.7 }),
      );
      drawer.position.set(0.28, 0.16 + i * 0.27, 0);
      dresserGroup.add(drawer);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 8),
        mat(0xcfa370, { roughness: 0.5 }),
      );
      knob.position.set(0.295, 0.16 + i * 0.27, 0);
      dresserGroup.add(knob);
    }
    // Small plant pot on top of dresser
    const potBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.1, 12),
      mat(0xc28dba, { roughness: 0.85 }),
    );
    potBody.position.set(0.05, 0.91, -0.3);
    potBody.castShadow = true;
    dresserGroup.add(potBody);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 6),
        mat(0x8aa68a, { roughness: 0.9 }),
      );
      leaf.position.set(0.05 + (Math.random() - 0.5) * 0.08, 1.0 + Math.random() * 0.06, -0.3 + (Math.random() - 0.5) * 0.08);
      leaf.scale.set(1.2, 0.7, 1.0);
      dresserGroup.add(leaf);
    }
    placeObject(dresserGroup, { name: 'dresser', x: dx, z: dz, blocking: body });

    // Top trinkets — small framed mirror collage on the wall above (decor, not part of dresser)
    for (let i = 0; i < 5; i++) {
      const mir = new THREE.Mesh(
        new THREE.CircleGeometry(0.06 + Math.random() * 0.04, 20),
        mat(0xd5e8f0, { roughness: 0.3, metalness: 0.4 }),
      );
      mir.rotation.y = Math.PI / 2;
      mir.position.set(
        -ROOM.w / 2 + 0.02,
        1.15 + (i % 2) * 0.18,
        dz - 0.3 + i * 0.16,
      );
      scene.add(mir);
    }
  }

  // --- Pine open-cubby vanity cabinet on left wall (between dresser and door) ---
  // Photo 2: a small honey-pine open cabinet with a 2x2 cubby grid full of
  // tiny things, sits between the door and the white dresser.
  {
    const cw = 0.42;   // along z
    const cd = 0.35;   // into room (x-axis)
    const ch = 1.05;   // total height
    const cx = -ROOM.w / 2 + cd / 2 + 0.04;
    const cz = 2.55;
    const woodMat = mat(PAL.wood, { roughness: 0.85 });
    // Back panel
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.025, ch, cw), woodMat);
    back.position.set(cx - cd / 2 + 0.012, ch / 2, cz);
    scene.add(back);
    // Top/bottom + side panels
    for (const dy of [0, ch]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(cd, 0.03, cw + 0.04), woodMat);
      slab.position.set(cx, dy, cz);
      scene.add(slab);
    }
    for (const dz of [-cw / 2, cw / 2]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(cd, ch, 0.03), woodMat);
      side.position.set(cx, ch / 2, cz + dz);
      scene.add(side);
    }
    // Horizontal shelf (mid)
    const midShelf = new THREE.Mesh(new THREE.BoxGeometry(cd, 0.02, cw), woodMat);
    midShelf.position.set(cx, ch * 0.5, cz);
    scene.add(midShelf);
    // Vertical divider
    const vDiv = new THREE.Mesh(new THREE.BoxGeometry(cd, ch, 0.02), woodMat);
    vDiv.position.set(cx, ch / 2, cz);
    scene.add(vDiv);

    // Small mirror leaning in one of the upper cubbies
    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.20),
      mat(0xd5e8f0, { roughness: 0.2, metalness: 0.55 }),
    );
    mirror.rotation.y = Math.PI / 2;
    mirror.position.set(cx + 0.10, ch * 0.78, cz - cw / 4);
    scene.add(mirror);
    const mirrorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.22, 0.17),
      mat(0xfffaf2, { roughness: 0.7 }),
    );
    mirrorFrame.position.set(cx + 0.105, ch * 0.78, cz - cw / 4);
    scene.add(mirrorFrame);

    // Tiny mixed items in cubbies
    const tinyColors = [0xf2a957, 0x88b774, 0xe97a8c, 0x6cb6d6, 0xc28dba, 0xf6cf57];
    const cellCenters = [
      [-cw / 4, ch * 0.75],
      [ cw / 4, ch * 0.75],
      [-cw / 4, ch * 0.25],
      [ cw / 4, ch * 0.25],
    ];
    for (let i = 0; i < cellCenters.length; i++) {
      const [dzCell, yCell] = cellCenters[i];
      // 2-3 random tiny items per cubby
      for (let k = 0; k < 3; k++) {
        const isBlock = (i + k) % 2 === 0;
        const item = new THREE.Mesh(
          isBlock
            ? new THREE.BoxGeometry(0.05, 0.05, 0.05)
            : new THREE.SphereGeometry(0.028, 8, 6),
          mat(tinyColors[(i * 3 + k) % tinyColors.length], { roughness: 0.85 }),
        );
        item.position.set(
          cx + 0.04 + (k - 1) * 0.06,
          yCell - ch * 0.10,
          cz + dzCell + (k % 2 ? 0.04 : -0.04),
        );
        scene.add(item);
      }
    }

    // Drawer hint on bottom half — single front drawer face
    const drawer = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.16, cw - 0.04),
      mat(0xd8c39a, { roughness: 0.8 }),
    );
    drawer.position.set(cx + cd / 2 - 0.005, ch * 0.18, cz);
    scene.add(drawer);
    // Drawer knob
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 10, 8),
      mat(0x5a4332, { roughness: 0.6 }),
    );
    knob.position.set(cx + cd / 2 + 0.012, ch * 0.18, cz);
    scene.add(knob);
  }

  // --- Ceiling mobile with bunny silhouettes (rose-gold hoop above pine wardrobe) ---
  {
    const mx = 1.9, mz = -0.3, my = 2.30;
    // Cord from ceiling
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.5, 6),
      mat(0xcfa370, { roughness: 0.5 }),
    );
    cord.position.set(mx, my + 0.25, mz);
    scene.add(cord);
    // Rose-gold hoop
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.012, 8, 28),
      mat(0xe3a89a, { roughness: 0.4, metalness: 0.5 }),
    );
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(mx, my, mz);
    scene.add(hoop);
    // Photo 3: a more elaborate mobile with mixed shapes hanging from threads
    // — ice cream cones, hearts, rainbow beads, bunny silhouettes. 8 items
    // around the hoop with varied dangle heights.
    const danglers = [
      { kind: 'icecream', a: 0, len: 0.20 },
      { kind: 'heart',    a: Math.PI / 4, len: 0.28 },
      { kind: 'rainbow',  a: Math.PI / 2, len: 0.22 },
      { kind: 'bunny',    a: Math.PI * 0.75, len: 0.30 },
      { kind: 'icecream', a: Math.PI, len: 0.24 },
      { kind: 'heart',    a: Math.PI * 1.25, len: 0.20 },
      { kind: 'rainbow',  a: Math.PI * 1.5, len: 0.32 },
      { kind: 'bunny',    a: Math.PI * 1.75, len: 0.24 },
    ];
    for (const d of danglers) {
      const bx = mx + Math.cos(d.a) * 0.24;
      const bz = mz + Math.sin(d.a) * 0.24;
      // Thread
      const string = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0018, 0.0018, d.len, 6),
        mat(0xeae0c4, { roughness: 0.7 }),
      );
      string.position.set(bx, my - d.len / 2, bz);
      scene.add(string);
      const itemY = my - d.len - 0.04;
      if (d.kind === 'icecream') {
        // Tiny ice cream cone
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.025, 0.06, 8),
          mat(0xd4a674, { roughness: 0.9 }),
        );
        cone.rotation.x = Math.PI;
        cone.position.set(bx, itemY, bz);
        scene.add(cone);
        const scoop = new THREE.Mesh(
          new THREE.SphereGeometry(0.028, 10, 8),
          mat(0xf7b6c0, { roughness: 0.9 }),
        );
        scoop.position.set(bx, itemY + 0.04, bz);
        scene.add(scoop);
      } else if (d.kind === 'heart') {
        const heart = new THREE.Group();
        for (const dx of [-0.018, 0.018]) {
          const lobe = new THREE.Mesh(
            new THREE.SphereGeometry(0.020, 10, 8),
            mat(0xe96b6b, { roughness: 0.9 }),
          );
          lobe.position.set(dx, 0.005, 0);
          lobe.scale.set(0.95, 0.7, 0.6);
          heart.add(lobe);
        }
        const tip = new THREE.Mesh(
          new THREE.ConeGeometry(0.028, 0.034, 4),
          mat(0xe96b6b, { roughness: 0.9 }),
        );
        tip.rotation.x = Math.PI;
        tip.scale.set(1.0, 1.0, 0.55);
        tip.position.set(0, -0.020, 0);
        heart.add(tip);
        heart.position.set(bx, itemY, bz);
        scene.add(heart);
      } else if (d.kind === 'rainbow') {
        // Stacked rainbow arcs (3 colored arc bars)
        const rcols = [0xe96b6b, 0xf4d55c, 0x9ac4e9];
        for (let k = 0; k < 3; k++) {
          const arc = new THREE.Mesh(
            new THREE.TorusGeometry(0.025 + k * 0.012, 0.005, 6, 12, Math.PI),
            mat(rcols[k], { roughness: 0.85 }),
          );
          arc.rotation.z = Math.PI;
          arc.position.set(bx, itemY + 0.02 + k * 0.005, bz);
          scene.add(arc);
        }
        // Cloud below
        for (const cx of [-0.022, 0.022, 0]) {
          const cloud = new THREE.Mesh(
            new THREE.SphereGeometry(0.020, 8, 6),
            mat(0xfffaf2, { roughness: 0.95 }),
          );
          cloud.position.set(bx + cx, itemY - 0.005, bz);
          scene.add(cloud);
        }
      } else { // bunny
        const bunny = new THREE.Mesh(
          new THREE.BoxGeometry(0.045, 0.06, 0.012),
          mat(0xfae0d5, { roughness: 0.85 }),
        );
        bunny.position.set(bx, itemY + 0.005, bz);
        scene.add(bunny);
        for (const ex of [-0.010, 0.010]) {
          const ear = new THREE.Mesh(
            new THREE.BoxGeometry(0.010, 0.030, 0.012),
            mat(0xfae0d5),
          );
          ear.position.set(bx + ex, itemY + 0.045, bz);
          scene.add(ear);
        }
      }
    }
    // A few colorful beads strung around the hoop
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 8, 6),
        mat([0xd97b8a, 0xf4d55c, 0x9ac4e9, 0xc28dba, 0x8aa68a, 0xf4a8b8][i % 6]),
      );
      bead.position.set(mx + Math.cos(a) * 0.28, my, mz + Math.sin(a) * 0.28);
      scene.add(bead);
    }
  }

  // --- 1-2-3 numbers poster leaning against the pine shelf (front face) ---
  {
    // Photo: a tall framed numbers poster propped at the foot of the shelf.
    const px = 2.10;     // just in front of pine shelf face
    const pz = 0.55;     // toward the front end of the shelf footprint
    const w = 0.46, h = 0.60;
    const posterFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, h + 0.06, w + 0.06),
      mat(0x2a1f1c, { roughness: 0.6 }),
    );
    posterFrame.position.set(px, 0.32 + h / 2, pz);
    posterFrame.rotation.z = -0.06; // slight lean
    scene.add(posterFrame);
    const posterFace = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      mat(0xfaf6ee, { roughness: 0.95 }),
    );
    posterFace.rotation.y = -Math.PI / 2;
    posterFace.position.set(px - 0.015, 0.32 + h / 2, pz);
    posterFace.rotation.z = -0.06;
    scene.add(posterFace);
    // Number dots in a 4x3 grid (1..9 + 0)
    const numColors = [0xd97b8a, 0xf4a261, 0xf4d55c, 0x8aa68a, 0x9ac4e9, 0xc28dba, 0xe96b6b, 0xe9c46a, 0xf4a8b8, 0xb8e5c4];
    for (let i = 0; i < 10; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.045, 18),
        mat(numColors[i], { roughness: 0.85 }),
      );
      dot.rotation.y = -Math.PI / 2;
      dot.position.set(
        px - 0.018,
        0.32 + h - 0.10 - row * 0.18,
        pz + w / 2 - 0.10 - col * 0.13,
      );
      dot.rotation.z = -0.06;
      scene.add(dot);
    }
  }

  // --- Big wall-mounted 1234567890 number poster on right wall ---
  // Photo 2 shows a tall framed poster with 1-9 and 0 in two rows above
  // the pine wardrobe. White background, big colored numbers.
  {
    const wx = ROOM.w / 2 - 0.025;   // just inside the right wall
    const wy = 1.95;                  // centered above the pine shelf top
    const wz = 0.55;                  // toward the door-side end of the shelf
    const pw = 0.55, ph = 0.74;
    // Frame
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, ph + 0.05, pw + 0.05),
      mat(0xf0e7da, { roughness: 0.7 }),
    );
    frame.position.set(wx, wy, wz);
    scene.add(frame);
    // Face
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      mat(0xfaf4ea, { roughness: 0.95 }),
    );
    face.rotation.y = -Math.PI / 2;
    face.position.set(wx - 0.013, wy, wz);
    scene.add(face);
    // Number "blobs" arranged as a 5x2 grid (1-5 top row, 6-9 0 bottom row)
    // Each digit gets a distinctly colored circular dot (kid-poster style)
    const palette = [
      0xe97a8c, 0xf2a957, 0xf6cf57, 0x88b774, 0x6cb6d6,
      0xa48ec6, 0xe06b6b, 0xf2c14e, 0xf09bb9, 0x8fc9a3,
    ];
    const cols = 5, rows = 2;
    for (let i = 0; i < 10; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const cx = -(pw / 2) + (c + 0.5) * (pw / cols);
      const cy = (ph / 2) - (r + 0.5) * (ph / rows);
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.045, 20),
        mat(palette[i], { roughness: 0.9 }),
      );
      dot.rotation.y = -Math.PI / 2;
      dot.position.set(wx - 0.014, wy + cy, wz + cx);
      scene.add(dot);
    }
  }

  // --- Light blue rolling chair, tucked in front of the desk ---
  // Sits a small step in front of the desk on the back wall so it reads as
  // "pulled out from the desk" rather than floating on the rug.
  {
    const cx = 1.40, cz = -2.10;
    const seatMat = mat(0x9ec8d4, { roughness: 0.85 });
    const seat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 18),
      seatMat,
    );
    seat.position.set(cx, 0.42, cz);
    seat.castShadow = true; seat.receiveShadow = true;
    scene.add(seat);
    // Back — on the +z side so a person seated faces -z (toward the desk)
    const backRest = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.35, 0.05),
      seatMat,
    );
    backRest.position.set(cx, 0.62, cz + 0.16);
    backRest.castShadow = true;
    scene.add(backRest);
    // Center post
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.35, 10),
      mat(0xbfb0a0, { roughness: 0.7 }),
    );
    post.position.set(cx, 0.22, cz);
    scene.add(post);
    // 5-star base
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.04, 0.05),
        mat(0x3a2e2a, { roughness: 0.7 }),
      );
      arm.position.set(cx + Math.cos(a) * 0.1, 0.05, cz + Math.sin(a) * 0.1);
      arm.rotation.y = -a;
      arm.castShadow = true;
      scene.add(arm);
      const wheel = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 6),
        mat(0x2a1f1c),
      );
      wheel.position.set(cx + Math.cos(a) * 0.2, 0.03, cz + Math.sin(a) * 0.2);
      scene.add(wheel);
    }
  }

  // --- Tall pink corner curtain in back-left corner ---
  // Photo 1: a separate pink curtain panel hangs floor-to-ceiling at the
  // back-left corner of the room — adds vertical softness beside the bunk.
  {
    const cx = -ROOM.w / 2 + 0.10;
    const cz = -ROOM.d / 2 + 0.30;
    const cw = 0.45, cd = 0.10, ch = 2.30;
    // Curtain body (slightly bowed via repeated pleats)
    const fabricMat = mat(0xf4c8c8, { roughness: 0.98 });
    const main = new THREE.Mesh(
      new THREE.BoxGeometry(cd, ch, cw),
      fabricMat,
    );
    main.position.set(cx, ch / 2, cz);
    main.castShadow = true;
    scene.add(main);
    // Vertical pleats for fabric folds
    for (let i = 0; i < 5; i++) {
      const pleat = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, ch - 0.05, 0.02),
        mat(0xe9b0b0, { roughness: 0.95 }),
      );
      pleat.position.set(cx + cd / 2 + 0.002, ch / 2, cz - cw / 2 + 0.05 + i * (cw / 5));
      scene.add(pleat);
    }
    // Curtain rod above
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, cw + 0.08, 10),
      mat(0xcfa370, { roughness: 0.5 }),
    );
    rod.rotation.x = Math.PI / 2;
    rod.position.set(cx, ch + 0.04, cz);
    scene.add(rod);
  }

  // --- Pink curtains on either side of the window ---
  {
    const wzz = -ROOM.d / 2 + 0.04;
    for (const sx of [-1.05, 1.05]) {
      const curtain = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 1.4, 0.04),
        mat(0xf4c8c8, { roughness: 0.98 }),
      );
      curtain.position.set(sx, 1.7, wzz);
      curtain.castShadow = true;
      scene.add(curtain);
      // Pleat lines
      for (let i = 0; i < 3; i++) {
        const pleat = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 1.36, 0.005),
          mat(0xe9b0b0, { roughness: 0.95 }),
        );
        pleat.position.set(sx - 0.07 + i * 0.07, 1.7, wzz + 0.022);
        scene.add(pleat);
      }
    }
    // Curtain rod
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 2.4, 10),
      mat(0xcfa370, { roughness: 0.5 }),
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 2.42, wzz);
    scene.add(rod);
  }

  // --- Pink elephant plush on the upper bunk (next to the unicorn) ---
  {
    const ex = -2.05, ey = 1.69, ez = 0.45;
    const e = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 14, 12),
      mat(0xf4a8b8, { roughness: 0.98 }),
    );
    body.scale.set(1.2, 0.85, 1.0);
    body.castShadow = true;
    e.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      mat(0xf4a8b8, { roughness: 0.98 }),
    );
    head.position.set(0.16, 0.1, 0);
    e.add(head);
    // Trunk
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.025, 0.16, 10),
      mat(0xf4a8b8, { roughness: 0.98 }),
    );
    trunk.position.set(0.24, 0.0, 0);
    trunk.rotation.z = -1.1;
    e.add(trunk);
    // Ears
    for (const z of [-0.1, 0.1]) {
      const ear = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 10, 8),
        mat(0xf4a8b8, { roughness: 0.98 }),
      );
      ear.position.set(0.13, 0.16, z);
      ear.scale.set(0.5, 1.0, 1.1);
      e.add(ear);
    }
    // Eyes
    for (const z of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0x2a1f1c));
      eye.position.set(0.22, 0.12, z);
      e.add(eye);
    }
    e.position.set(ex, ey, ez);
    e.rotation.y = 0.5;
    scene.add(e);
  }

  // --- Pink frog plush on the upper bunk (Photo 2 hero plush) ---
  {
    const fx = -1.95, fy = 1.70, fz = -0.45;
    const f = new THREE.Group();
    const frogPink = 0xf28aa6;
    // Squishy round body
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 16, 14),
      mat(frogPink, { roughness: 0.95 }),
    );
    body.scale.set(1.1, 0.95, 1.0);
    body.castShadow = true;
    f.add(body);
    // Belly (lighter)
    const belly = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 12),
      mat(0xfac6d0, { roughness: 0.95 }),
    );
    belly.scale.set(1.0, 0.75, 0.6);
    belly.position.set(0.05, -0.04, 0);
    f.add(belly);
    // Two domed eyes
    for (const z of [-0.07, 0.07]) {
      const eyeDome = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 12, 10),
        mat(frogPink, { roughness: 0.95 }),
      );
      eyeDome.position.set(0.05, 0.16, z);
      f.add(eyeDome);
      const eyeWhite = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 12, 10),
        mat(0xfffaf2, { roughness: 0.95 }),
      );
      eyeWhite.position.set(0.10, 0.17, z);
      f.add(eyeWhite);
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 6),
        mat(0x2a1f1c),
      );
      pupil.position.set(0.13, 0.17, z);
      f.add(pupil);
    }
    // Smile (thin curved tube)
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.005, 6, 10, Math.PI * 0.8),
      mat(0x2a1f1c, { roughness: 0.9 }),
    );
    smile.rotation.y = Math.PI / 2;
    smile.rotation.z = Math.PI;
    smile.position.set(0.16, 0.0, 0);
    f.add(smile);
    // Tiny side legs
    for (const z of [-0.13, 0.13]) {
      const leg = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 10, 8),
        mat(frogPink, { roughness: 0.95 }),
      );
      leg.position.set(0.04, -0.10, z);
      leg.scale.set(1.0, 0.5, 0.7);
      f.add(leg);
    }
    f.position.set(fx, fy, fz);
    f.rotation.y = 0.6;
    scene.add(f);
  }

  // --- Pink dollhouse / play castle on the pine shelf ---
  {
    const hx = 2.20, hy = 1.07, hz = -0.35;
    const houseMat = mat(0xf4a8b8, { roughness: 0.9 });
    const roofMat = mat(0xd97b8a, { roughness: 0.9 });
    // Main box body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.3), houseMat);
    body.position.set(hx, hy, hz);
    body.castShadow = true; body.receiveShadow = true;
    scene.add(body);
    // Pitched roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.22, 4), roofMat);
    roof.position.set(hx, hy + 0.27, hz);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    scene.add(roof);
    // Door
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.16, 0.08),
      mat(0xfffaf2, { roughness: 0.85 }),
    );
    door.position.set(hx + 0.215, hy - 0.07, hz);
    scene.add(door);
    // Round window
    const win = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 18),
      mat(0xfffaf2, { roughness: 0.7 }),
    );
    win.rotation.y = Math.PI / 2;
    win.position.set(hx + 0.215, hy + 0.07, hz - 0.08);
    scene.add(win);
    // Side flower decoration
    for (let i = 0; i < 3; i++) {
      const petal = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 6),
        mat([0xf4d55c, 0xfffaf2, 0xc28dba][i]),
      );
      petal.position.set(hx + 0.215, hy - 0.02 + i * 0.04, hz + 0.06 + i * 0.02);
      scene.add(petal);
    }
    // Tiny turret on the side
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 14), houseMat);
    turret.position.set(hx - 0.18, hy + 0.05, hz + 0.18);
    scene.add(turret);
    const turretRoof = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.1, 14), roofMat);
    turretRoof.position.set(hx - 0.18, hy + 0.2, hz + 0.18);
    scene.add(turretRoof);
  }

  // --- My Melody-style bunny plush on the upper bunk pillow ---
  {
    const mx = -2.05, my = 1.7, mz = -1.1;
    const m = new THREE.Group();
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 12),
      mat(0xfaf6ee, { roughness: 0.98 }),
    );
    head.castShadow = true;
    m.add(head);
    // Pink hood
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 14, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(0xf4a8b8, { roughness: 0.98 }),
    );
    hood.position.y = 0.02;
    m.add(hood);
    // Ears poking out of hood
    for (const x of [-0.06, 0.06]) {
      const earHood = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 10, 8),
        mat(0xf4a8b8),
      );
      earHood.position.set(x, 0.16, 0);
      earHood.scale.set(0.7, 1.4, 0.7);
      m.add(earHood);
    }
    // Eyes
    for (const x of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0x2a1f1c));
      eye.position.set(x, 0.02, 0.13);
      m.add(eye);
    }
    // Nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0xf4a8b8));
    nose.position.set(0, -0.02, 0.14);
    m.add(nose);
    m.position.set(mx, my, mz);
    m.rotation.y = 0.3;
    scene.add(m);
  }

  // --- Pink storage baskets on top of the pine wardrobe ---
  {
    // Wardrobe AABB covers x=2.26..2.71, z=-0.60..1.00. Center baskets
    // tightly on the top surface so they don't visually float past the edge.
    const baseY = 1.92;
    const bx = 2.48;
    const zSlots = [-0.30, 0.20, 0.70];
    for (let i = 0; i < 3; i++) {
      const basket = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.30, 0.40),
        mat([0xf4c8c8, 0xf6cfcb, 0xe9b0b0][i], { roughness: 0.95 }),
      );
      basket.position.set(bx, baseY + 0.15, zSlots[i]);
      basket.castShadow = true; basket.receiveShadow = true;
      scene.add(basket);
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(0.39, 0.02, 0.41),
        mat(0xfffaf2, { roughness: 0.8 }),
      );
      rim.position.set(bx, baseY + 0.31, zSlots[i]);
      scene.add(rim);
    }
  }

  // --- Hanging pink dress on a hook beside the wardrobe ---
  {
    const hx = ROOM.w / 2 - 0.05;
    const hy = 1.6, hz = 1.4;
    // Wall hook
    const hook = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.04, 8),
      mat(0xcfa370),
    );
    hook.rotation.z = Math.PI / 2;
    hook.position.set(hx - 0.03, hy + 0.45, hz);
    scene.add(hook);
    // Hanger
    const hanger = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.006, 6, 12, Math.PI),
      mat(0xbfb0a0),
    );
    hanger.position.set(hx - 0.05, hy + 0.42, hz);
    hanger.rotation.x = Math.PI / 2;
    scene.add(hanger);
    // Dress body (pink, tapered)
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.18, 0.55, 16),
      mat(0xf4a8b8, { roughness: 0.95 }),
    );
    torso.position.set(hx - 0.06, hy + 0.12, hz);
    torso.castShadow = true;
    scene.add(torso);
    // Skirt flare ruffle
    const ruffle = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.12, 18, 1, true),
      mat(0xfae0d5, { roughness: 0.95, side: THREE.DoubleSide }),
    );
    ruffle.position.set(hx - 0.06, hy - 0.18, hz);
    scene.add(ruffle);
  }

  // --- Pencil "HELLO KITTY" scribble doodles on left wall above white dresser ---
  // Photo 3: faint pencil scribbles on the wall above the dresser — small Hello
  // Kitty face + curly squiggles + tiny hearts (kid's handwriting decor).
  {
    const wx = -ROOM.w / 2 + 0.015;
    const baseY = 1.40, baseZ = 1.65;
    const pencilMat = mat(0xb19a87, { roughness: 0.85 });
    const pinkInk = mat(0xe9a4b4, { roughness: 0.85 });

    // Hello Kitty face outline — circle head + 2 triangular ears + bow + dots
    const headRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.005, 6, 32),
      pencilMat,
    );
    headRing.rotation.y = Math.PI / 2;
    headRing.position.set(wx, baseY, baseZ - 0.10);
    scene.add(headRing);
    // Two pointy ears (small triangles approximated by cones)
    for (const dz of [-0.05, 0.05]) {
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.018, 0.04, 4),
        pencilMat,
      );
      ear.rotation.z = Math.PI / 2;
      ear.position.set(wx, baseY + 0.08, baseZ - 0.10 + dz);
      ear.rotation.x = dz < 0 ? -0.4 : 0.4;
      scene.add(ear);
    }
    // Bow (two pink small triangles)
    for (const sgn of [-1, 1]) {
      const bow = new THREE.Mesh(
        new THREE.ConeGeometry(0.018, 0.03, 4),
        pinkInk,
      );
      bow.rotation.z = Math.PI / 2;
      bow.position.set(wx + 0.003, baseY + 0.06, baseZ - 0.10 + sgn * 0.04);
      bow.rotation.x = sgn * 0.6;
      scene.add(bow);
    }
    // Tiny dot eyes
    for (const dz of [-0.025, 0.025]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.005, 6, 6),
        pencilMat,
      );
      eye.position.set(wx + 0.002, baseY, baseZ - 0.10 + dz);
      scene.add(eye);
    }

    // Squiggle scribble next to face — wavy line approximation
    for (let i = 0; i < 12; i++) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(0.003, 0.022, 0.014),
        pencilMat,
      );
      seg.position.set(
        wx,
        baseY + Math.sin(i * 0.8) * 0.05 + 0.20,
        baseZ + 0.05 + i * 0.025,
      );
      seg.rotation.x = Math.sin(i * 0.8) * 0.4;
      scene.add(seg);
    }

    // 3 tiny pink heart scribbles scattered around
    const heartLocs = [
      { y: baseY + 0.25, z: baseZ - 0.05 },
      { y: baseY - 0.15, z: baseZ + 0.10 },
      { y: baseY + 0.05, z: baseZ + 0.30 },
    ];
    for (const h of heartLocs) {
      for (const dz of [-0.012, 0.012]) {
        const lobe = new THREE.Mesh(
          new THREE.SphereGeometry(0.014, 6, 6),
          pinkInk,
        );
        lobe.position.set(wx, h.y + 0.008, h.z + dz);
        scene.add(lobe);
      }
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.018, 0.028, 4),
        pinkInk,
      );
      tip.rotation.z = Math.PI / 2;
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(wx, h.y - 0.015, h.z);
      scene.add(tip);
    }

    // Kid-style letter strokes — approximate "ELLINOR" as a row of dashes
    for (let i = 0; i < 8; i++) {
      const stroke = new THREE.Mesh(
        new THREE.BoxGeometry(0.004, 0.04, 0.020),
        pencilMat,
      );
      stroke.position.set(wx, baseY - 0.32, baseZ - 0.20 + i * 0.06);
      stroke.rotation.x = (Math.random() - 0.5) * 0.3;
      scene.add(stroke);
    }
  }

  // --- Dance/ballerina posters on left wall ---
  {
    const lwx = -ROOM.w / 2 + 0.02;
    const postersData = [
      { y: 1.55, z: 0.20, palette: [0xf4a8b8, 0xfae0d5] },
      { y: 1.85, z: 0.85, palette: [0x9ac4e9, 0xfae0d5] },
      { y: 1.45, z: 1.30, palette: [0xc28dba, 0xfae0d5] },
    ];
    for (const p of postersData) {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.32, 0.22),
        mat(0xfffaf2, { roughness: 0.7 }),
      );
      frame.position.set(lwx + 0.005, p.y, p.z);
      scene.add(frame);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.28),
        mat(p.palette[1], { roughness: 0.95 }),
      );
      face.rotation.y = Math.PI / 2;
      face.position.set(lwx + 0.015, p.y, p.z);
      scene.add(face);
      // Stylised ballerina silhouette: oval body + dress triangle
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 8),
        mat(p.palette[0], { roughness: 0.95 }),
      );
      body.rotation.y = Math.PI / 2;
      body.position.set(lwx + 0.018, p.y + 0.04, p.z);
      scene.add(body);
      const skirt = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.08, 12),
        mat(p.palette[0], { roughness: 0.95 }),
      );
      skirt.rotation.z = Math.PI;
      skirt.rotation.y = Math.PI / 2;
      skirt.position.set(lwx + 0.018, p.y - 0.03, p.z);
      scene.add(skirt);
    }
  }

  // --- Stuffed raccoon plush sitting on the rug (matches the rug character) ---
  {
    const r = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 12),
      mat(0xbfb0a0, { roughness: 0.98 }),
    );
    body.scale.set(1.0, 0.95, 1.1);
    body.castShadow = true;
    r.add(body);
    // Black mask across eyes
    const mask = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.04, 0.02),
      mat(0x2a1f1c, { roughness: 0.98 }),
    );
    mask.position.set(0, 0.04, 0.115);
    r.add(mask);
    for (const x of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat(0xfffaf2));
      eye.position.set(x, 0.04, 0.13);
      r.add(eye);
    }
    // Nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0x2a1f1c));
    nose.position.set(0, -0.02, 0.14);
    r.add(nose);
    // Ears
    for (const x of [-0.08, 0.08]) {
      const ear = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 10, 8),
        mat(0x6a5a52, { roughness: 0.98 }),
      );
      ear.position.set(x, 0.11, 0.02);
      ear.scale.set(0.9, 1.0, 0.6);
      r.add(ear);
    }
    // Striped tail (3 segments) sticking out behind
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 10, 8),
        mat(i % 2 === 0 ? 0x6a5a52 : 0xfaf6ee, { roughness: 0.98 }),
      );
      seg.position.set(0, -0.02 - i * 0.005, -0.13 - i * 0.06);
      r.add(seg);
    }
    r.position.set(-0.95, 0.13, 0.7);
    r.rotation.y = 0.6;
    scene.add(r);
  }

  // --- Small wastebasket near the desk ---
  {
    const bx = ROOM.w / 2 - 0.45, bz = -2.05;
    const bin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.1, 0.28, 16),
      mat(0xfae0d5, { roughness: 0.85 }),
    );
    bin.position.set(bx, 0.14, bz);
    bin.castShadow = true; bin.receiveShadow = true;
    scene.add(bin);
    // Rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.012, 6, 16),
      mat(0xfffaf2),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(bx, 0.28, bz);
    scene.add(rim);
  }

  // --- Fairy-light garland strung along the left wall above the bunk ---
  // Photo 1 shows white string lights draped in a gentle catenary above the
  // bunk. Approximate with a chain of tiny emissive spheres on a sagging arc.
  {
    const lwx = -ROOM.w / 2 + 0.03;
    const zStart = -2.9;
    const zEnd = -0.4;
    const yTop = 2.20;
    const sag = 0.18;
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff3d6, emissive: 0xfff0c4, emissiveIntensity: 0.6, roughness: 0.4,
    });
    const cordMat = mat(0x4a3a32, { roughness: 0.8 });
    const N = 24;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const z = zStart + (zEnd - zStart) * t;
      // Two-arc droop so it looks like the cord is tacked at three points
      const sub = (t * 2) % 1;
      const y = yTop - sag * 4 * sub * (1 - sub);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), bulbMat);
      bulb.position.set(lwx, y, z);
      scene.add(bulb);
      if (prev) {
        const dx = 0, dy = y - prev.y, dz = z - prev.z;
        const len = Math.hypot(dx, dy, dz);
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, len, 5),
          cordMat,
        );
        seg.position.set(lwx + 0.005, (y + prev.y) / 2, (z + prev.z) / 2);
        // Orient cylinder (default +Y) toward the next bulb
        const axis = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3(dx, dy, dz).normalize();
        seg.quaternion.setFromUnitVectors(axis, dir);
        scene.add(seg);
      }
      prev = { y, z };
    }
  }

  // --- Pink calendar/checklist on the wall above the dresser ---
  {
    const lwx = -ROOM.w / 2 + 0.02;
    const calBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.36),
      mat(0xfae0d5, { roughness: 0.95 }),
    );
    calBack.rotation.y = Math.PI / 2;
    calBack.position.set(lwx + 0.02, 1.45, 2.05);
    scene.add(calBack);
    // Grid lines (rows of days)
    for (let i = 0; i < 5; i++) {
      const row = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.005, 0.24),
        mat(0xc28dba),
      );
      row.position.set(lwx + 0.022, 1.55 - i * 0.05, 2.05);
      scene.add(row);
    }
  }

  // --- Fairy lights strung across the back wall (over the window) ---
  // Photo 2: a draped strand spans the back wall above the bunk. Matches
  // the existing left-wall garland for symmetry.
  {
    const bwz = -ROOM.d / 2 + 0.04;
    const xStart = -ROOM.w / 2 + 0.5;
    const xEnd = ROOM.w / 2 - 0.5;
    const yTop = 2.30;
    const sag = 0.16;
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff3d6, emissive: 0xfff0c4, emissiveIntensity: 0.6, roughness: 0.4,
    });
    const cordMat = mat(0x4a3a32, { roughness: 0.8 });
    const N = 26;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = xStart + (xEnd - xStart) * t;
      // Three sub-arcs so the strand reads like it's pinned at four points.
      const sub = (t * 3) % 1;
      const y = yTop - sag * 4 * sub * (1 - sub);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), bulbMat);
      bulb.position.set(x, y, bwz);
      scene.add(bulb);
      if (prev) {
        const dx = x - prev.x, dy = y - prev.y;
        const len = Math.hypot(dx, dy);
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, len, 5),
          cordMat,
        );
        seg.position.set((x + prev.x) / 2, (y + prev.y) / 2, bwz + 0.005);
        const axis = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3(dx, dy, 0).normalize();
        seg.quaternion.setFromUnitVectors(axis, dir);
        scene.add(seg);
      }
      prev = { x, y };
    }
  }

  // --- Rainbow-mane lion plush sitting on top of the pine shelf ---
  // Photo 2: signature beige lion with a spiky rainbow mane. Sits above the
  // cubbies on the pine wardrobe.
  {
    const lx = 2.30, ly = 1.45, lz = 0.55;
    const g = new THREE.Group();
    // Beige body
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 14, 12),
      mat(0xe9c46a, { roughness: 0.95 }),
    );
    body.scale.set(1.0, 0.95, 1.0);
    body.castShadow = true;
    g.add(body);
    // Face cream patch
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      mat(0xfff3d6, { roughness: 0.95 }),
    );
    face.position.set(0, -0.02, 0.07);
    g.add(face);
    // Spiky rainbow mane — ring of small cones around the head
    const maneColors = [0xe96b6b, 0xf4a261, 0xf4d55c, 0x8aa68a, 0x9ac4e9, 0xc28dba];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.022, 0.07, 6),
        mat(maneColors[i % maneColors.length], { roughness: 0.9 }),
      );
      // Skew the cones outward from the head's hemisphere
      spike.position.set(
        Math.cos(a) * 0.14,
        0.02 + Math.sin(i * 1.3) * 0.04,
        Math.sin(a) * 0.14,
      );
      spike.lookAt(spike.position.clone().multiplyScalar(2));
      spike.rotateX(Math.PI / 2);
      g.add(spike);
    }
    // Eyes + nose
    for (const x of [-0.035, 0.035]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mat(0x2a1f1c));
      eye.position.set(x, 0.0, 0.13);
      g.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat(0x3a2e2a));
    nose.position.set(0, -0.04, 0.135);
    g.add(nose);
    // Tiny ears
    for (const x of [-0.07, 0.07]) {
      const ear = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 6),
        mat(0xe9c46a, { roughness: 0.95 }),
      );
      ear.position.set(x, 0.10, 0.02);
      ear.scale.set(0.7, 0.7, 0.4);
      g.add(ear);
    }
    g.position.set(lx, ly, lz);
    g.rotation.y = -0.4;
    g.scale.setScalar(1.55);
    scene.add(g);
  }

  // --- Pink rainbow-cloud plush on the upper bunk ---
  // Photo 3: chunky pink plush with rainbow stripes + cloud detail.
  {
    const cx = -2.00, cy = 1.66, cz = -0.10;
    const g = new THREE.Group();
    // Cloud body (chubby pink)
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 14, 12),
      mat(0xf4a8b8, { roughness: 0.95 }),
    );
    body.scale.set(1.3, 0.95, 0.9);
    body.castShadow = true;
    g.add(body);
    // Cloud bumps
    for (const off of [[-0.10, 0.10], [0.10, 0.10], [-0.18, 0.0], [0.18, 0.0]]) {
      const bump = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        mat(0xf4a8b8, { roughness: 0.95 }),
      );
      bump.position.set(off[0], off[1], 0);
      g.add(bump);
    }
    // Rainbow arc on the front (5 thin coloured torii)
    const arcColors = [0xe96b6b, 0xf4a261, 0xf4d55c, 0x8aa68a, 0x9ac4e9];
    for (let i = 0; i < arcColors.length; i++) {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.05 - i * 0.008, 0.006, 6, 14, Math.PI),
        mat(arcColors[i], { roughness: 0.85 }),
      );
      arc.rotation.x = -Math.PI / 2;
      arc.rotation.y = 0;
      arc.position.set(-0.02, 0.02, 0.10);
      g.add(arc);
    }
    // Eyes (sleepy dots)
    for (const x of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.005, 0.005),
        mat(0x2a1f1c),
      );
      eye.position.set(x, 0.04, 0.14);
      g.add(eye);
    }
    // Small heart on the side
    const heart = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 8, 6),
      mat(0xe96b6b, { roughness: 0.9 }),
    );
    heart.position.set(0.12, -0.04, 0.10);
    g.add(heart);
    g.position.set(cx, cy, cz);
    g.rotation.y = 0.6;
    scene.add(g);
  }

  // --- Kid easel front-left, near the door ---
  // Photo 2 bottom-left: A-frame wooden easel with a large paper pad and
  // crayon scribbles. Tucked against the front wall away from foot traffic.
  {
    const ex = -2.05, ez = 2.65;
    const woodMat = mat(0xbfa078, { roughness: 0.85 });
    const easel = new THREE.Group();
    // Three legs (A-frame: 2 front, 1 back)
    const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.0, 8);
    const legL = new THREE.Mesh(legGeo, woodMat);
    legL.position.set(-0.18, 0.5, 0.0);
    legL.rotation.z = 0.12;
    legL.rotation.x = -0.1;
    easel.add(legL);
    const legR = new THREE.Mesh(legGeo, woodMat);
    legR.position.set(0.18, 0.5, 0.0);
    legR.rotation.z = -0.12;
    legR.rotation.x = -0.1;
    easel.add(legR);
    const legB = new THREE.Mesh(legGeo, woodMat);
    legB.position.set(0.0, 0.5, -0.20);
    legB.rotation.x = 0.18;
    easel.add(legB);
    // Cross brace
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.015, 0.015),
      woodMat,
    );
    brace.position.set(0, 0.34, 0.05);
    easel.add(brace);
    // Paper pad (large white sheet)
    const paper = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.55, 0.012),
      mat(0xfffaf2, { roughness: 0.95 }),
    );
    paper.position.set(0, 0.74, 0.06);
    paper.rotation.x = -0.05;
    paper.castShadow = true;
    easel.add(paper);
    // A few crayon scribbles on the paper
    const scribbleColors = [0xe96b6b, 0x9ac4e9, 0xf4d55c, 0x8aa68a];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(0.12 + Math.random() * 0.18, 0.018, 0.002),
        mat(scribbleColors[i], { roughness: 0.9 }),
      );
      s.position.set(
        (Math.random() - 0.5) * 0.3,
        0.55 + i * 0.10,
        0.067,
      );
      s.rotation.z = (Math.random() - 0.5) * 0.6;
      s.rotation.x = -0.05;
      easel.add(s);
    }
    // Crayon tray at the bottom
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.03, 0.06),
      woodMat,
    );
    tray.position.set(0, 0.46, 0.07);
    easel.add(tray);
    // Crayons in the tray
    const crayColors = [0xe96b6b, 0xf4a261, 0xf4d55c, 0x8aa68a, 0x9ac4e9, 0xc28dba];
    for (let i = 0; i < crayColors.length; i++) {
      const cray = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8),
        mat(crayColors[i], { roughness: 0.8 }),
      );
      cray.rotation.z = Math.PI / 2;
      cray.position.set(-0.18 + i * 0.07, 0.49, 0.09);
      easel.add(cray);
    }
    easel.position.set(ex, 0, ez);
    easel.rotation.y = -0.6;
    scene.add(easel);
  }

  // --- Fill the pine shelf cubbies with colorful toys ---
  // Photo 2: every cubby is crammed with small bright items. Adds density
  // without modelling individual toys.
  {
    const cubbyFront = 2.30;
    const toyColors = [0xe96b6b, 0xf4a261, 0xf4d55c, 0x8aa68a, 0x9ac4e9, 0xc28dba, 0xf4a8b8, 0xbfa078];
    // Each cubby: [centerY, centerZ]
    const cubbies = [
      [0.18, -0.30], [0.18, 0.15], [0.18, 0.60],
      [0.65, -0.30], [0.65, 0.15], [0.65, 0.60],
      [1.08, 0.60],                  // right side of middle row (dollhouse takes left)
      [1.40, -0.30], [1.40, 0.15],   // top row
    ];
    for (const [cy, cz] of cubbies) {
      // 2-3 small toys per cubby
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const shape = Math.floor(Math.random() * 3);
        const color = toyColors[Math.floor(Math.random() * toyColors.length)];
        let mesh;
        if (shape === 0) {
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.07, 0.07, 0.07),
            mat(color, { roughness: 0.9 }),
          );
        } else if (shape === 1) {
          mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 10, 8),
            mat(color, { roughness: 0.9 }),
          );
        } else {
          mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10),
            mat(color, { roughness: 0.9 }),
          );
        }
        mesh.position.set(
          cubbyFront - 0.05 + (Math.random() - 0.5) * 0.05,
          cy - 0.05 + Math.random() * 0.04,
          cz - 0.10 + i * 0.10 + (Math.random() - 0.5) * 0.04,
        );
        mesh.rotation.y = Math.random() * Math.PI;
        mesh.castShadow = true;
        scene.add(mesh);
      }
    }
  }

  // --- Hello Kitty striped quilt on the lower bunk ---
  // Photo 1: dark pink + white horizontal-stripe quilt with a side panel that
  // hangs off the front of the lower mattress.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const lowerY = 0.55;
    const pink = mat(0xe88aa6, { roughness: 0.95 });
    const cream = mat(0xfff3ec, { roughness: 0.95 });
    // Mattress-top quilt: stripes alternating along z
    const quiltGroup = new THREE.Group();
    const stripeCount = 10;
    for (let i = 0; i < stripeCount; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(bedW - 0.08, 0.015, bedL / stripeCount),
        i % 2 === 0 ? pink : cream,
      );
      stripe.position.set(
        bedX,
        lowerY + 0.18,
        bedZ - bedL / 2 + (i + 0.5) * (bedL / stripeCount),
      );
      stripe.castShadow = true;
      quiltGroup.add(stripe);
    }
    // Side drape hanging off front of the lower mattress
    const drapeH = 0.32;
    for (let i = 0; i < stripeCount; i++) {
      const drape = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, drapeH / stripeCount, bedL / stripeCount),
        i % 2 === 0 ? pink : cream,
      );
      drape.position.set(
        bedX + bedW / 2 - 0.04,
        lowerY + 0.17 - drapeH / 2 + (i % 2 === 0 ? 0 : drapeH / stripeCount * 0.3),
        bedZ - bedL / 2 + (i + 0.5) * (bedL / stripeCount),
      );
      quiltGroup.add(drape);
    }
    // Continuous drape backing so we don't see through gaps
    const drapeBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, drapeH, bedL - 0.08),
      pink,
    );
    drapeBack.position.set(bedX + bedW / 2 - 0.045, lowerY + 0.01, bedZ);
    quiltGroup.add(drapeBack);
    // Pillow at headboard end (z = back, smaller z)
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(bedW - 0.18, 0.10, 0.42),
      cream,
    );
    pillow.position.set(bedX, lowerY + 0.23, bedZ - bedL / 2 + 0.28);
    pillow.castShadow = true;
    quiltGroup.add(pillow);
    scene.add(quiltGroup);
  }

  // --- Plushy pile on the lower bunk ---
  // Photo 1: clutter of small pink/white plushies + a black cat plush.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const lowerTop = 0.55 + 0.20;
    const plushyColors = [0xf4a8b8, 0xfff3d6, 0xe88aa6, 0xd8b8f4];
    // Round plushies near foot end
    const slots = [
      [bedX - 0.18, lowerTop + 0.04, bedZ + 0.55],
      [bedX + 0.05, lowerTop + 0.05, bedZ + 0.75],
      [bedX - 0.10, lowerTop + 0.04, bedZ + 0.95],
      [bedX + 0.10, lowerTop + 0.04, bedZ + 0.30],
    ];
    for (let i = 0; i < slots.length; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 12, 10),
        mat(plushyColors[i % plushyColors.length], { roughness: 0.95 }),
      );
      p.position.set(slots[i][0], slots[i][1], slots[i][2]);
      p.scale.set(1.0, 0.85, 1.0);
      p.castShadow = true;
      scene.add(p);
      // Tiny ears for variety
      if (i % 2 === 0) {
        for (const ex of [-0.05, 0.05]) {
          const ear = new THREE.Mesh(
            new THREE.SphereGeometry(0.035, 8, 6),
            mat(plushyColors[i % plushyColors.length], { roughness: 0.95 }),
          );
          ear.position.set(slots[i][0] + ex, slots[i][1] + 0.08, slots[i][2]);
          ear.scale.set(0.6, 1.0, 0.5);
          scene.add(ear);
        }
      }
    }
    // Black cat plush near middle of bed
    {
      const cat = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 14, 12),
        mat(0x1a1a1a, { roughness: 0.95 }),
      );
      body.scale.set(1.2, 0.7, 1.0);
      body.castShadow = true;
      cat.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 12, 10),
        mat(0x1a1a1a, { roughness: 0.95 }),
      );
      head.position.set(0.10, 0.05, 0);
      cat.add(head);
      // Triangle ears
      for (const ex of [-0.04, 0.04]) {
        const ear = new THREE.Mesh(
          new THREE.ConeGeometry(0.025, 0.05, 4),
          mat(0x1a1a1a, { roughness: 0.95 }),
        );
        ear.position.set(0.10 + ex, 0.13, 0);
        cat.add(ear);
      }
      // Pink nose
      const nose = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 6),
        mat(0xf4a8b8, { roughness: 0.9 }),
      );
      nose.position.set(0.18, 0.05, 0);
      cat.add(nose);
      cat.position.set(bedX + 0.15, lowerTop + 0.07, bedZ + 0.0);
      cat.rotation.y = -0.4;
      scene.add(cat);
    }
  }

  // --- Bunny silhouette wall hangers above the pine shelf ---
  // Photo 2 top-right: three wooden bunny-ear silhouettes mounted on the
  // right wall, with a pink dress hanging from one.
  {
    const wallX = ROOM.w / 2 - 0.04;
    const hangerY = 1.95;
    const hangerZs = [-0.30, 0.10, 0.50];
    const woodTone = mat(0xc9a679, { roughness: 0.7 });
    for (const hz of hangerZs) {
      const g = new THREE.Group();
      // Round base disk
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.012, 14),
        woodTone,
      );
      base.rotation.z = Math.PI / 2;
      base.position.set(0, 0, 0);
      g.add(base);
      // Two ears poking up
      for (const ex of [-0.025, 0.025]) {
        const ear = new THREE.Mesh(
          new THREE.SphereGeometry(0.022, 10, 8),
          woodTone,
        );
        ear.scale.set(0.45, 1.6, 0.45);
        ear.position.set(0, 0.045, ex);
        g.add(ear);
      }
      // Small peg poking out
      const peg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.04, 8),
        woodTone,
      );
      peg.rotation.z = Math.PI / 2;
      peg.position.set(-0.025, -0.02, 0);
      g.add(peg);
      g.position.set(wallX, hangerY, hz);
      g.rotation.y = Math.PI / 2;
      scene.add(g);
    }
    // Pink dress hanging from middle hanger
    {
      const dress = new THREE.Group();
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.10, 0.22),
        mat(0xf4a8b8, { roughness: 0.95 }),
      );
      top.position.set(0, 0, 0);
      dress.add(top);
      // Skirt cone widening downward
      const skirt = new THREE.Mesh(
        new THREE.ConeGeometry(0.20, 0.30, 14, 1, true),
        mat(0xf4a8b8, { roughness: 0.95 }),
      );
      skirt.rotation.x = Math.PI;
      skirt.position.set(0, -0.20, 0);
      skirt.scale.set(0.7, 1.0, 1.4);
      dress.add(skirt);
      dress.position.set(wallX - 0.06, hangerY - 0.05, 0.10);
      scene.add(dress);
    }
  }

  // --- Sun-burst clock on the right wall (above the pine shelf) ---
  // Photo 1: white-rayed sun clock visible above the wardrobe.
  {
    const wallX = ROOM.w / 2 - 0.04;
    const cy = 2.05;
    const cz = -1.10;
    const g = new THREE.Group();
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.02, 24),
      mat(0xfffaf2, { roughness: 0.85 }),
    );
    face.rotation.z = Math.PI / 2;
    g.add(face);
    // Sun rays — 16 thin spikes
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const ray = new THREE.Mesh(
        new THREE.ConeGeometry(0.012, 0.10, 4),
        mat(0xfffaf2, { roughness: 0.85 }),
      );
      ray.position.set(
        -0.005,
        Math.sin(a) * 0.21,
        Math.cos(a) * 0.21,
      );
      ray.rotation.x = a;
      g.add(ray);
    }
    // Clock hands
    const hourHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.07, 0.012),
      mat(0x2a1f1c),
    );
    hourHand.position.set(-0.015, 0.025, 0);
    g.add(hourHand);
    const minHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.10, 0.008),
      mat(0x2a1f1c),
    );
    minHand.position.set(-0.018, 0, 0.04);
    minHand.rotation.x = Math.PI / 4;
    g.add(minHand);
    // Center dot
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 10, 8),
      mat(0x2a1f1c),
    );
    dot.position.set(-0.012, 0, 0);
    g.add(dot);
    g.position.set(wallX, cy, cz);
    scene.add(g);
  }

  // --- Children's drawings clustered on the right wall ---
  // Photo 1: several taped-up small drawings above the pine shelf area.
  {
    const wallX = ROOM.w / 2 - 0.035;
    const drawings = [
      { y: 1.92, z: -1.55, w: 0.22, h: 0.30, color: 0xfff8e6, accent: 0xe96b6b },
      { y: 2.08, z: -1.85, w: 0.18, h: 0.22, color: 0xfffaf2, accent: 0x9ac4e9 },
      { y: 1.78, z: -1.92, w: 0.20, h: 0.18, color: 0xfff8e6, accent: 0x8aa68a },
      { y: 1.62, z: -1.65, w: 0.16, h: 0.22, color: 0xfffaf2, accent: 0xf4d55c },
    ];
    for (const d of drawings) {
      const paper = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, d.h, d.w),
        mat(d.color, { roughness: 0.95 }),
      );
      paper.position.set(wallX, d.y, d.z);
      paper.rotation.x = (Math.random() - 0.5) * 0.06;
      scene.add(paper);
      // A couple of scribbles
      for (let i = 0; i < 3; i++) {
        const scr = new THREE.Mesh(
          new THREE.BoxGeometry(0.004, 0.012, 0.04 + Math.random() * 0.06),
          mat(d.accent, { roughness: 0.9 }),
        );
        scr.position.set(
          wallX - 0.005,
          d.y - d.h / 2 + 0.04 + i * (d.h / 3.5),
          d.z + (Math.random() - 0.5) * (d.w - 0.06),
        );
        scr.rotation.x = (Math.random() - 0.5) * 0.5;
        scene.add(scr);
      }
      // Tape mark at the top
      const tape = new THREE.Mesh(
        new THREE.BoxGeometry(0.003, 0.018, 0.05),
        mat(0xeeeeea, { roughness: 0.7, transparent: true, opacity: 0.85 }),
      );
      tape.position.set(wallX - 0.005, d.y + d.h / 2 - 0.01, d.z);
      scene.add(tape);
    }
  }

  // --- Diagonal pom-pom garland across the upper bunk rail ---
  // Photo 2: a string of white/pastel pom-poms drapes diagonally from the
  // back-top of the upper bunk down toward the front rail corner.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const railX = bedX + bedW / 2 - 0.05;       // outer rail front face
    const yTop = 1.45 + 0.60;                   // upper rail top
    const zBack = bedZ - bedL / 2 + 0.10;
    const zFront = bedZ + bedL / 2 - 0.20;
    const pomColors = [0xfff3ec, 0xf4a8b8, 0xfff3ec, 0xd5e8f0, 0xfff3ec, 0xf4d55c];
    const N = 18;
    const cordMat = mat(0xeeeae0, { roughness: 0.9 });
    let prev = null;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const z = zBack + (zFront - zBack) * t;
      // Diagonal: starts at yTop near back, ends a bit lower near front
      const yLine = yTop - 0.45 * t;
      // Add subtle sag between anchors (2 sub-arcs)
      const sub = (t * 2) % 1;
      const y = yLine - 0.08 * 4 * sub * (1 - sub);
      const pom = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 8),
        mat(pomColors[i % pomColors.length], { roughness: 0.95 }),
      );
      pom.position.set(railX + 0.015, y, z);
      scene.add(pom);
      if (prev) {
        const dy = y - prev.y, dz = z - prev.z;
        const len = Math.hypot(dy, dz);
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, len, 5),
          cordMat,
        );
        seg.position.set(railX + 0.012, (y + prev.y) / 2, (z + prev.z) / 2);
        const axis = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3(0, dy, dz).normalize();
        seg.quaternion.setFromUnitVectors(axis, dir);
        scene.add(seg);
      }
      prev = { y, z };
    }
  }

  // --- Framed pictures cluster on left wall above the dresser ---
  // Photo 2: small framed prints and a couple of family photos on the wall
  // between the door and the bunk.
  {
    const wallX = -ROOM.w / 2 + 0.035;
    const frames = [
      { y: 1.55, z: 1.35, w: 0.22, h: 0.28, frame: 0x6b4f3a, paper: 0xfff3ec },
      { y: 1.80, z: 1.65, w: 0.16, h: 0.20, frame: 0xfffaf2, paper: 0xfff3ec },
      { y: 1.40, z: 1.95, w: 0.18, h: 0.14, frame: 0x2a1f1c, paper: 0xfff3ec },
      { y: 1.72, z: 2.05, w: 0.14, h: 0.18, frame: 0xc9a679, paper: 0xfff3ec },
    ];
    for (const f of frames) {
      // Frame border
      const border = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, f.h, f.w),
        mat(f.frame, { roughness: 0.75 }),
      );
      border.position.set(wallX, f.y, f.z);
      scene.add(border);
      // Inner paper
      const paper = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, f.h - 0.025, f.w - 0.025),
        mat(f.paper, { roughness: 0.9 }),
      );
      paper.position.set(wallX + 0.008, f.y, f.z);
      scene.add(paper);
      // A pop of color "subject" in the picture
      const subjectColors = [0xe96b6b, 0x9ac4e9, 0x8aa68a, 0xf4d55c, 0xc28dba];
      const subj = new THREE.Mesh(
        new THREE.BoxGeometry(0.003, (f.h - 0.06) * (0.4 + Math.random() * 0.4),
                              (f.w - 0.06) * (0.4 + Math.random() * 0.4)),
        mat(subjectColors[Math.floor(Math.random() * subjectColors.length)],
            { roughness: 0.9 }),
      );
      subj.position.set(wallX + 0.013, f.y + (Math.random() - 0.5) * 0.04,
                        f.z + (Math.random() - 0.5) * 0.04);
      scene.add(subj);
    }
  }

  // --- White roller blind across the window (half-pulled) ---
  {
    const wz = -ROOM.d / 2 + 0.06;
    const winW = 1.8, winY = 1.55, winH = 1.3;
    const fabricMat = mat(0xfaf6ec, { roughness: 0.95 });
    // Top roller tube
    const roller = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, winW + 0.08, 12),
      mat(0xece6d6, { roughness: 0.7 }),
    );
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, winY + winH / 2 + 0.03, wz + 0.025);
    scene.add(roller);
    // Roller end caps
    for (const sx of [-(winW + 0.08) / 2 - 0.005, (winW + 0.08) / 2 + 0.005]) {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10),
        mat(0xfffaf2, { roughness: 0.7 }),
      );
      cap.rotation.z = Math.PI / 2;
      cap.position.set(sx, winY + winH / 2 + 0.03, wz + 0.025);
      scene.add(cap);
    }
    // Fabric panel — pulled down about 55% of window height
    const fabricH = winH * 0.55;
    const fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(winW + 0.02, fabricH),
      fabricMat,
    );
    fabric.position.set(0, winY + winH / 2 - fabricH / 2, wz + 0.018);
    scene.add(fabric);
    // Bottom weight rod (slim cylinder)
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, winW + 0.04, 10),
      mat(0xece6d6, { roughness: 0.7 }),
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, winY + winH / 2 - fabricH - 0.005, wz + 0.020);
    scene.add(rod);
    // Center tassel/pull at bottom
    const tassel = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 8, 6),
      mat(0xfffaf2, { roughness: 0.85 }),
    );
    tassel.position.set(0, winY + winH / 2 - fabricH - 0.04, wz + 0.026);
    scene.add(tassel);
    // Side chain pull cord (looped)
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0025, 0.0025, 0.55, 4),
      mat(0xc8c0b0, { roughness: 0.7, metalness: 0.3 }),
    );
    chain.position.set(winW / 2 + 0.05, winY + 0.05, wz + 0.030);
    scene.add(chain);
  }

  // --- Hello Kitty plush on the upper bunk pillow ---
  // Photo 2: small white plush with a pink bow nestled against the pillow.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const upperTop = 1.45 + 0.20;
    const g = new THREE.Group();
    // Round white head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 14, 12),
      mat(0xfffaf2, { roughness: 0.95 }),
    );
    head.scale.set(1.1, 0.95, 0.95);
    head.castShadow = true;
    g.add(head);
    // Round body (slightly smaller, sits below head)
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 12, 10),
      mat(0xfffaf2, { roughness: 0.95 }),
    );
    body.position.set(0, -0.10, 0);
    body.scale.set(1.0, 0.85, 0.95);
    g.add(body);
    // Two pointy ears
    for (const ex of [-0.06, 0.06]) {
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.025, 0.05, 6),
        mat(0xfffaf2, { roughness: 0.95 }),
      );
      ear.position.set(ex, 0.075, 0.0);
      ear.rotation.z = ex < 0 ? -0.3 : 0.3;
      g.add(ear);
    }
    // Pink bow (left side of head)
    const bow = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 10, 8),
      mat(0xf4a8b8, { roughness: 0.9 }),
    );
    bow.scale.set(1.4, 1.0, 0.5);
    bow.position.set(-0.06, 0.05, 0.06);
    g.add(bow);
    // Yellow nose dot
    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 6),
      mat(0xf4d55c, { roughness: 0.85 }),
    );
    nose.position.set(0, -0.005, 0.084);
    g.add(nose);
    // Eyes
    for (const ex of [-0.025, 0.025]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 6, 6),
        mat(0x1a1a1a),
      );
      eye.position.set(ex, 0.01, 0.08);
      g.add(eye);
    }
    // Tiny gold crown sitting on top of head (photo 2 detail)
    const crown = new THREE.Group();
    const crownMat = mat(0xf4d55c, { roughness: 0.5, metalness: 0.5 });
    // Band
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.04, 0.020, 12),
      crownMat,
    );
    band.position.set(0, 0.115, 0);
    g.add(band);
    // 5 points
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.010, 0.025, 6),
        crownMat,
      );
      tip.position.set(Math.cos(a) * 0.030, 0.135, Math.sin(a) * 0.030);
      g.add(tip);
      // Pink jewel at base of each point
      const jewel = new THREE.Mesh(
        new THREE.SphereGeometry(0.005, 6, 6),
        mat(0xe96b9a, { roughness: 0.4 }),
      );
      jewel.position.set(Math.cos(a) * 0.030, 0.125, Math.sin(a) * 0.030);
      g.add(jewel);
    }
    g.position.set(bedX - 0.18, upperTop + 0.08, bedZ - bedL / 2 + 0.32);
    g.rotation.y = 0.3;
    scene.add(g);
  }

  // --- Stickers on the pine wardrobe door ---
  // Photo 1: rainbow + pony stickers stuck on the front-facing pine panel.
  {
    const sx = ROOM.w / 2 - 0.45 / 2 - 0.04;     // matches pine wardrobe sx
    const stickerX = sx - 0.45 / 2 - 0.01;        // just on the +z face? actually the wardrobe panel facing the room is at sx - sd/2
    // Rainbow sticker (concentric arcs)
    {
      const rainbowZ = 0.85;
      const rainbowY = 1.05;
      const rainbow = new THREE.Group();
      const arcColors = [0xe96b6b, 0xf4a261, 0xf4d55c, 0x8aa68a, 0x9ac4e9, 0xc28dba];
      for (let i = 0; i < arcColors.length; i++) {
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(0.05 + i * 0.012, 0.005, 6, 16, Math.PI),
          mat(arcColors[i], { roughness: 0.7 }),
        );
        arc.rotation.y = Math.PI / 2;
        arc.position.set(0, 0, 0);
        rainbow.add(arc);
      }
      // Two small clouds at the rainbow base
      for (const cx of [-0.07, 0.07]) {
        const cloud = new THREE.Mesh(
          new THREE.SphereGeometry(0.022, 10, 8),
          mat(0xfffaf2, { roughness: 0.9 }),
        );
        cloud.scale.set(1.4, 0.7, 0.5);
        cloud.position.set(0, -0.005, cx);
        rainbow.add(cloud);
      }
      rainbow.position.set(stickerX, rainbowY, rainbowZ);
      scene.add(rainbow);
    }
    // Three small pony silhouettes scattered nearby
    const ponyColors = [0xf4a8b8, 0xc28dba, 0xfff3d6];
    for (let i = 0; i < 3; i++) {
      const pony = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 8),
        mat(ponyColors[i], { roughness: 0.85 }),
      );
      body.scale.set(1.3, 0.8, 0.6);
      pony.add(body);
      // Mane (rainbow)
      const mane = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 6),
        mat(0xe96b6b, { roughness: 0.8 }),
      );
      mane.position.set(0.015, 0.012, 0);
      mane.scale.set(0.5, 1.2, 0.6);
      pony.add(mane);
      // Tail
      const tail = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 6, 6),
        mat(0xc28dba, { roughness: 0.8 }),
      );
      tail.position.set(-0.022, 0, 0);
      tail.scale.set(1.5, 1.2, 0.5);
      pony.add(tail);
      pony.position.set(
        stickerX - 0.002,
        0.65 + (i * 0.18),
        0.20 + (i % 2) * 0.30,
      );
      pony.rotation.y = Math.PI / 2;
      scene.add(pony);
    }
  }

  // --- Floor game boxes stacked in front of the bunk ---
  // Photo 1 lower-left: a couple of board game boxes and a puzzle box piled
  // up next to the bunk-foot ladder area.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    // Tucked tight against the side rail of the bunk so it reads as
    // "stacked next to the bed" rather than scattered in the middle.
    const gx = bedX + bedW / 2 + 0.20;
    const gz = bedZ + bedL / 2 - 0.05;
    const boxes = [
      { w: 0.45, h: 0.05, d: 0.32, color: 0xf4d55c, y: 0.025 },
      { w: 0.40, h: 0.05, d: 0.28, color: 0xe96b6b, y: 0.075 },
      { w: 0.38, h: 0.05, d: 0.30, color: 0x9ac4e9, y: 0.125 },
    ];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, b.d),
        mat(b.color, { roughness: 0.85 }),
      );
      m.position.set(gx + i * 0.02, b.y, gz + i * 0.03);
      m.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.12;
      m.castShadow = true;
      scene.add(m);
      // White label on top
      const label = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.6, 0.002, b.d * 0.5),
        mat(0xfffaf2, { roughness: 0.9 }),
      );
      label.position.copy(m.position);
      label.position.y = b.y + b.h / 2 + 0.003;
      label.rotation.y = m.rotation.y;
      scene.add(label);
    }
  }

  // --- Toy organizer with colorful plastic bins ---
  // Photo 1 lower-center: small white cubby unit holding tilted colorful bins.
  {
    const ox = -ROOM.w / 2 + 1.50;
    const oz = -0.40;
    const frame = new THREE.Group();
    // White cubby case (3 cubbies wide × 2 tall)
    const caseW = 0.78, caseH = 0.50, caseD = 0.32;
    const caseMat = mat(0xfffaf2, { roughness: 0.8 });
    // Outer shell — box with cubby cut-outs simulated via thin shelves
    const back = new THREE.Mesh(new THREE.BoxGeometry(caseW, caseH, 0.012), caseMat);
    back.position.set(0, caseH / 2, -caseD / 2 + 0.006);
    frame.add(back);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(caseW, 0.012, caseD), caseMat);
    bottom.position.set(0, 0.006, 0);
    frame.add(bottom);
    const top = new THREE.Mesh(new THREE.BoxGeometry(caseW, 0.012, caseD), caseMat);
    top.position.set(0, caseH - 0.006, 0);
    frame.add(top);
    const midShelf = new THREE.Mesh(new THREE.BoxGeometry(caseW, 0.012, caseD), caseMat);
    midShelf.position.set(0, caseH / 2, 0);
    frame.add(midShelf);
    const leftSide = new THREE.Mesh(new THREE.BoxGeometry(0.012, caseH, caseD), caseMat);
    leftSide.position.set(-caseW / 2 + 0.006, caseH / 2, 0);
    frame.add(leftSide);
    const rightSide = new THREE.Mesh(new THREE.BoxGeometry(0.012, caseH, caseD), caseMat);
    rightSide.position.set(caseW / 2 - 0.006, caseH / 2, 0);
    frame.add(rightSide);
    // Two vertical dividers
    for (const dx of [-caseW / 6, caseW / 6]) {
      const div = new THREE.Mesh(new THREE.BoxGeometry(0.012, caseH - 0.024, caseD - 0.024), caseMat);
      div.position.set(dx, caseH / 2, 0);
      frame.add(div);
    }
    // Colorful plastic bins, one in each cubby
    const binColors = [0xf4a8b8, 0xf4d55c, 0x9ac4e9, 0xe96b6b, 0x8aa68a, 0xc28dba];
    const cubbyW = (caseW - 0.036) / 3;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const bin = new THREE.Mesh(
          new THREE.BoxGeometry(cubbyW - 0.03, caseH / 2 - 0.04, caseD - 0.06),
          mat(binColors[row * 3 + col], { roughness: 0.6, transparent: true, opacity: 0.85 }),
        );
        bin.position.set(
          -caseW / 2 + 0.018 + col * cubbyW + cubbyW / 2,
          (row + 0.5) * (caseH / 2),
          0.005,
        );
        bin.castShadow = true;
        frame.add(bin);
      }
    }
    // Rotate so the wide face is along z and back against the left wall,
    // tucked between the bunk-foot and the dresser.
    frame.position.set(-ROOM.w / 2 + 0.20, 0, 0.55);
    frame.rotation.y = Math.PI / 2;
    scene.add(frame);
  }

  // --- Pink privacy curtain hanging from the upper-bunk outer rail ---
  // Photo 1 left side: long pink curtain pulled to one end of the rail.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const railX = bedX + bedW / 2 - 0.05;
    const railTopY = 1.45 + 0.6;
    // Curtain panel — gathered toward the back end of the rail
    const curtainGroup = new THREE.Group();
    const panelH = 0.85;
    for (let i = 0; i < 6; i++) {
      const fold = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, panelH, 0.08),
        mat(0xf4c4cc, { roughness: 0.95 }),
      );
      fold.position.set(
        railX + 0.02 + (i % 2) * 0.018,
        railTopY - panelH / 2 - 0.02,
        bedZ - bedL / 2 + 0.20 + i * 0.10,
      );
      fold.castShadow = true;
      curtainGroup.add(fold);
    }
    // Top tie-back at the rail
    const tie = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.04, 0.70),
      mat(0xe88aa6, { roughness: 0.9 }),
    );
    tie.position.set(railX + 0.025, railTopY - 0.05, bedZ - bedL / 2 + 0.50);
    curtainGroup.add(tie);
    scene.add(curtainGroup);
  }

  // --- Triangular vanity mirror on top of the dresser ---
  // Photo 2: a small white-framed triangle mirror sits atop the dresser.
  {
    const dx = -ROOM.w / 2 + 0.32;
    const dz = 1.65;
    const mTop = 0.85;
    const frameMat = mat(0xfffaf2, { roughness: 0.5 });
    const glassMat = mat(0xc8dde0, { roughness: 0.15, metalness: 0.5 });
    const triShape = new THREE.Shape();
    triShape.moveTo(-0.16, 0);
    triShape.lineTo(0.16, 0);
    triShape.lineTo(0, 0.30);
    triShape.lineTo(-0.16, 0);
    // Outer frame (slightly larger)
    const frameShape = new THREE.Shape();
    frameShape.moveTo(-0.18, -0.02);
    frameShape.lineTo(0.18, -0.02);
    frameShape.lineTo(0, 0.34);
    frameShape.lineTo(-0.18, -0.02);
    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(frameShape, { depth: 0.015, bevelEnabled: false }),
      frameMat,
    );
    frame.rotation.y = Math.PI / 2;
    frame.position.set(dx + 0.20, mTop, dz + 0.10);
    frame.castShadow = true;
    scene.add(frame);
    const glass = new THREE.Mesh(
      new THREE.ExtrudeGeometry(triShape, { depth: 0.005, bevelEnabled: false }),
      glassMat,
    );
    glass.rotation.y = Math.PI / 2;
    glass.position.set(dx + 0.20 - 0.008, mTop, dz + 0.10);
    scene.add(glass);
    // Tiny base support
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.015, 0.10),
      frameMat,
    );
    base.position.set(dx + 0.20, mTop, dz + 0.10);
    scene.add(base);
  }

  // --- Small toys / figurines scattered on the dresser top ---
  // Photo 2: a few small plastic figures sit on top of the dresser near
  // the plant pot.
  {
    const dx = -ROOM.w / 2 + 0.32;
    const dz = 1.65;
    const topY = 0.87;
    const figColors = [0xf4a8b8, 0x9ac4e9, 0xf4d55c, 0xc28dba];
    const offsets = [
      [0.08, -0.10], [0.18, 0.10], [-0.05, 0.25], [0.22, -0.25],
    ];
    for (let i = 0; i < offsets.length; i++) {
      const [ox, oz] = offsets[i];
      const fig = new THREE.Group();
      // Round head
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 8),
        mat(figColors[i], { roughness: 0.85 }),
      );
      head.position.set(0, 0.06, 0);
      fig.add(head);
      // Cylinder body
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.022, 0.05, 10),
        mat(figColors[i], { roughness: 0.85 }),
      );
      body.position.set(0, 0.025, 0);
      fig.add(body);
      // Hair / hat tuft
      const hat = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 6),
        mat(0x2a1f1c),
      );
      hat.position.set(0, 0.085, 0);
      hat.scale.set(1.0, 0.5, 1.0);
      fig.add(hat);
      fig.position.set(dx + ox, topY, dz + oz);
      fig.rotation.y = Math.random() * Math.PI;
      fig.castShadow = true;
      scene.add(fig);
    }
  }

  // --- Hanging black plush from the upper bunk's front rail ---
  // Photo 1: a black plushie hangs by a cord from the front rail; reads
  // like a cat or spider charm. Spider works well — six dangling legs.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const railX = bedX + bedW / 2 - 0.05;
    const railTopY = 1.45 + 0.6;
    const hangZ = bedZ + 0.40;
    const blackMat = mat(0x1a1a1a, { roughness: 0.95 });
    // Cord from rail down
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.30, 6),
      mat(0xeeeae0, { roughness: 0.9 }),
    );
    cord.position.set(railX + 0.04, railTopY - 0.15, hangZ);
    scene.add(cord);
    // Body
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 14, 10),
      blackMat,
    );
    body.scale.set(1.1, 0.9, 1.0);
    body.position.set(railX + 0.04, railTopY - 0.36, hangZ);
    body.castShadow = true;
    scene.add(body);
    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 10),
      blackMat,
    );
    head.position.set(railX + 0.10, railTopY - 0.34, hangZ);
    scene.add(head);
    // Two yellow eye dots on the head
    for (const ex of [-0.012, 0.012]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 6, 6),
        mat(0xf4d55c, { roughness: 0.7 }),
      );
      eye.position.set(railX + 0.13, railTopY - 0.32, hangZ + ex);
      scene.add(eye);
    }
    // Six dangling legs (spider)
    for (let i = 0; i < 6; i++) {
      const t = (i / 5);
      const az = hangZ - 0.05 + t * 0.10;
      const ax = railX + 0.04 + (i % 2 === 0 ? -0.04 : 0.04);
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.10, 6),
        blackMat,
      );
      leg.position.set(ax, railTopY - 0.44, az);
      leg.rotation.z = (i % 2 === 0 ? -0.4 : 0.4);
      scene.add(leg);
      // Foot ball
      const foot = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 6, 6),
        blackMat,
      );
      foot.position.set(ax + (i % 2 === 0 ? -0.025 : 0.025), railTopY - 0.49, az);
      scene.add(foot);
    }
  }

  // --- Narrow white art-supply cart in front of the bunk ---
  // Photo 1 middle: tall narrow white shelf with cubbies holding paint
  // pots, brushes, and small art bottles. Tucks against the bunk-foot side
  // toward the room center.
  {
    const cartX = -1.55, cartZ = -0.30;
    const cartW = 0.32, cartH = 1.05, cartD = 0.28;
    const cartMat = mat(0xfffaf2, { roughness: 0.8 });
    const cart = new THREE.Group();
    // Outer shell
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(cartW, cartH, 0.012),
      cartMat,
    );
    back.position.set(0, cartH / 2, -cartD / 2 + 0.006);
    cart.add(back);
    const left = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, cartH, cartD),
      cartMat,
    );
    left.position.set(-cartW / 2 + 0.006, cartH / 2, 0);
    cart.add(left);
    const right = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, cartH, cartD),
      cartMat,
    );
    right.position.set(cartW / 2 - 0.006, cartH / 2, 0);
    cart.add(right);
    // Four horizontal shelves
    for (let i = 0; i <= 4; i++) {
      const sh = new THREE.Mesh(
        new THREE.BoxGeometry(cartW, 0.012, cartD),
        cartMat,
      );
      sh.position.set(0, i * (cartH / 4), 0);
      cart.add(sh);
    }
    // Paint pots / brush jars on each shelf
    const potColors = [0xe96b6b, 0xf4a261, 0xf4d55c, 0x8aa68a, 0x9ac4e9, 0xc28dba, 0xf4a8b8];
    for (let i = 0; i < 4; i++) {
      const sy = i * (cartH / 4) + 0.04;
      for (let j = 0; j < 2; j++) {
        const pot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.045, 0.07, 10),
          mat(potColors[(i + j * 2) % potColors.length], { roughness: 0.85 }),
        );
        pot.position.set(-0.07 + j * 0.14, sy + 0.035, 0);
        cart.add(pot);
        // Brush sticking out
        if (i === 3 || (i === 1 && j === 1)) {
          const brush = new THREE.Mesh(
            new THREE.CylinderGeometry(0.005, 0.005, 0.10, 6),
            mat(0xbfa078, { roughness: 0.8 }),
          );
          brush.position.set(-0.07 + j * 0.14, sy + 0.10, 0);
          cart.add(brush);
        }
      }
    }
    cart.position.set(cartX, 0, cartZ);
    cart.castShadow = true; cart.receiveShadow = true;
    scene.add(cart);
  }

  // --- Pink play kitchen / oven ---
  // Photo 2: pink toddler kitchen with stove top and oven door, plus a sink.
  // Place it against the floor between the beanbag and the pine wardrobe.
  {
    const kx = 1.10, kz = 1.95;
    const kit = new THREE.Group();
    const pinkBody = mat(0xf4a8b8, { roughness: 0.85 });
    const whiteTop = mat(0xfffaf2, { roughness: 0.7 });
    const darkKnob = mat(0x2a1f1c);
    // Main body box
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 0.55, 0.32),
      pinkBody,
    );
    body.position.set(0, 0.275, 0);
    body.castShadow = true; body.receiveShadow = true;
    kit.add(body);
    // White stovetop
    const stovetop = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 0.015, 0.32),
      whiteTop,
    );
    stovetop.position.set(0, 0.555, 0);
    kit.add(stovetop);
    // Two burner circles
    for (const bx of [-0.16, 0.16]) {
      const burner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.005, 16),
        mat(0x2a1f1c, { roughness: 0.5 }),
      );
      burner.position.set(bx, 0.565, -0.04);
      kit.add(burner);
      // Burner coil inner ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.04, 0.005, 6, 16),
        mat(0xb83333, { roughness: 0.5, emissive: 0x4a0a0a, emissiveIntensity: 0.1 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(bx, 0.568, -0.04);
      kit.add(ring);
    }
    // Oven door (front face)
    const doorPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.30, 0.012),
      whiteTop,
    );
    doorPanel.position.set(0, 0.20, 0.165);
    kit.add(doorPanel);
    // Oven window (darker rectangle inside door)
    const ovenWin = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.18, 0.006),
      mat(0x4a3a32, { roughness: 0.4 }),
    );
    ovenWin.position.set(0, 0.22, 0.172);
    kit.add(ovenWin);
    // Oven handle
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.30, 8),
      mat(0xbfb0a0, { roughness: 0.4, metalness: 0.4 }),
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, 0.36, 0.18);
    kit.add(handle);
    // Two control knobs above oven door
    for (const dx of [-0.22, 0.22]) {
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.015, 10),
        darkKnob,
      );
      knob.rotation.x = Math.PI / 2;
      knob.position.set(dx, 0.48, 0.168);
      kit.add(knob);
    }
    // Back splash with little dial display
    const splash = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 0.18, 0.02),
      pinkBody,
    );
    splash.position.set(0, 0.65, -0.15);
    kit.add(splash);
    const dial = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 14),
      mat(0xfffaf2, { roughness: 0.7 }),
    );
    dial.position.set(-0.25, 0.66, -0.138);
    kit.add(dial);
    // Faucet on the right side (treat as sink half)
    const faucetBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.025, 0.06, 10),
      mat(0xbfb0a0, { roughness: 0.4, metalness: 0.5 }),
    );
    faucetBase.position.set(0.25, 0.59, -0.08);
    kit.add(faucetBase);
    const faucetNeck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8),
      mat(0xbfb0a0, { roughness: 0.4, metalness: 0.5 }),
    );
    faucetNeck.position.set(0.25, 0.64, -0.05);
    faucetNeck.rotation.x = -0.3;
    kit.add(faucetNeck);
    // A small pot on a burner
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.06, 14),
      mat(0xe96b6b, { roughness: 0.8 }),
    );
    pot.position.set(-0.16, 0.60, -0.04);
    kit.add(pot);
    const potHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.012, 0.012),
      mat(0x2a1f1c),
    );
    potHandle.position.set(-0.24, 0.605, -0.04);
    kit.add(potHandle);
    kit.position.set(kx, 0, kz);
    kit.rotation.y = -0.4;
    scene.add(kit);
  }

  // --- White sheep plush nestled with upper-bunk plushies ---
  // Photo 2: fluffy white sheep visible among the pile on the upper bunk.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const upperTop = 1.45 + 0.20;
    const sheep = new THREE.Group();
    // Cloud-like body (multiple overlapping spheres)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const lump = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        mat(0xfffaf2, { roughness: 0.98 }),
      );
      lump.position.set(Math.cos(a) * 0.06, 0.03 + (i % 2) * 0.01, Math.sin(a) * 0.05);
      sheep.add(lump);
    }
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      mat(0xfffaf2, { roughness: 0.98 }),
    );
    core.scale.set(1.2, 0.95, 1.0);
    core.castShadow = true;
    sheep.add(core);
    // Face — small dark snout
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 8),
      mat(0x3a2e2a, { roughness: 0.9 }),
    );
    face.scale.set(1.0, 0.85, 0.7);
    face.position.set(0.10, 0.0, 0.0);
    sheep.add(face);
    // Two ear flaps
    for (const ez of [-0.04, 0.04]) {
      const ear = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 8, 6),
        mat(0x3a2e2a, { roughness: 0.9 }),
      );
      ear.scale.set(0.5, 0.4, 1.0);
      ear.position.set(0.10, 0.05, ez);
      sheep.add(ear);
    }
    // Two eye dots
    for (const ez of [-0.018, 0.018]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 6, 6),
        mat(0x1a1a1a),
      );
      eye.position.set(0.135, 0.01, ez);
      sheep.add(eye);
    }
    sheep.position.set(bedX + 0.10, upperTop + 0.08, bedZ + 0.40);
    sheep.rotation.y = -0.5;
    scene.add(sheep);
  }

  // --- Pink ice cream cone plushie on upper bunk ---
  // Photo 3: a tall pink ice cream cone plushie hangs/sits among the upper
  // bunk pile — distinct silhouette. Cone bottom + double scoop top.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const upperTop = 1.45 + 0.20;
    const ice = new THREE.Group();
    // Waffle cone — light tan
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.24, 14, 1, true),
      mat(0xd4a674, { roughness: 0.9 }),
    );
    cone.rotation.x = Math.PI;
    cone.position.set(0, 0, 0);
    ice.add(cone);
    // Cross-hatch ridges on cone (4 rings)
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.062 - i * 0.013, 0.005, 6, 18),
        mat(0xb88a52, { roughness: 0.9 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.04 - i * 0.05;
      ice.add(ring);
    }
    // Lower scoop — pink strawberry
    const scoop1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 14, 12),
      mat(0xf7b6c0, { roughness: 0.95 }),
    );
    scoop1.scale.set(1.0, 0.85, 1.0);
    scoop1.position.set(0, 0.13, 0);
    ice.add(scoop1);
    // Upper scoop — lighter pink
    const scoop2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 14, 12),
      mat(0xfcd0d8, { roughness: 0.95 }),
    );
    scoop2.scale.set(1.0, 0.9, 1.0);
    scoop2.position.set(0, 0.26, 0);
    ice.add(scoop2);
    // Tiny cherry on top
    const cherry = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 8, 6),
      mat(0xd9344c, { roughness: 0.8 }),
    );
    cherry.position.set(0, 0.36, 0);
    ice.add(cherry);
    // Embroidered eyes (kawaii)
    for (const ex of [-0.025, 0.025]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 6, 6),
        mat(0x1a1a1a),
      );
      eye.position.set(ex, 0.14, 0.094);
      ice.add(eye);
    }
    // Tiny pink cheek dots
    for (const cx of [-0.05, 0.05]) {
      const cheek = new THREE.Mesh(
        new THREE.SphereGeometry(0.009, 6, 6),
        mat(0xf06b8c, { roughness: 0.9 }),
      );
      cheek.position.set(cx, 0.115, 0.085);
      ice.add(cheek);
    }
    ice.position.set(bedX + 0.30, upperTop + 0.18, bedZ + 0.85);
    ice.rotation.y = -0.4;
    ice.rotation.z = -0.08;  // slight tilt as it sits among other plush
    scene.add(ice);
  }

  // --- Pink heart plush dangling from upper bunk rail ---
  // Photo 3: a small pink heart-shaped plush visible at the bunk rail.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const railTop = 1.65 + 0.05;
    // Heart as two spheres + cone
    const heart = new THREE.Group();
    const heartMat = mat(0xf09bb9, { roughness: 0.9 });
    for (const dx of [-0.04, 0.04]) {
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), heartMat);
      lobe.position.set(dx, 0.02, 0);
      heart.add(lobe);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.10, 16), heartMat);
    tip.rotation.x = Math.PI;
    tip.position.set(0, -0.05, 0);
    heart.add(tip);
    heart.scale.set(1.0, 1.0, 0.6);
    heart.position.set(bedX + bedW / 2 - 0.05, railTop - 0.10, bedZ + 1.05);
    heart.rotation.y = -Math.PI / 2;
    heart.rotation.z = 0.15;
    scene.add(heart);
  }

  // --- Small pink children's vanity / dresser in the front-right corner ---
  // Photo 2: small pink themed cubby-dresser with white trim and a heart
  // sticker. Sits against the right wall in front of the pine wardrobe area.
  {
    const px = ROOM.w / 2 - 0.30, pz = 1.95;
    const dresser = new THREE.Group();
    const pinkBody = mat(0xf4a8b8, { roughness: 0.85 });
    const whiteTrim = mat(0xfffaf2, { roughness: 0.75 });
    const dW = 0.42, dH = 0.65, dD = 0.32;
    // Main body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(dW, dH, dD),
      pinkBody,
    );
    body.position.set(0, dH / 2, 0);
    body.castShadow = true; body.receiveShadow = true;
    dresser.add(body);
    // White top
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(dW + 0.02, 0.015, dD + 0.02),
      whiteTrim,
    );
    top.position.set(0, dH + 0.005, 0);
    dresser.add(top);
    // Three white drawer fronts
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(
        new THREE.BoxGeometry(dW - 0.08, 0.16, 0.012),
        whiteTrim,
      );
      drawer.position.set(0, 0.12 + i * 0.18, dD / 2 + 0.006);
      dresser.add(drawer);
      // Small white knob
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 6),
        mat(0xbfa078, { roughness: 0.5 }),
      );
      knob.position.set(0, 0.12 + i * 0.18, dD / 2 + 0.018);
      dresser.add(knob);
    }
    // Heart sticker on top drawer
    const heart = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 8, 6),
      mat(0xe96b6b, { roughness: 0.85 }),
    );
    heart.scale.set(1.3, 1.1, 0.4);
    heart.position.set(-0.10, 0.45, dD / 2 + 0.018);
    dresser.add(heart);
    // A small bowl / hairbrush on top
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.04, 0.03, 14),
      mat(0xfffaf2, { roughness: 0.8 }),
    );
    bowl.position.set(-0.10, dH + 0.025, 0.05);
    dresser.add(bowl);
    // Small play hairbrush
    const brushHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.10, 8),
      mat(0xc28dba, { roughness: 0.8 }),
    );
    brushHandle.rotation.z = Math.PI / 2;
    brushHandle.position.set(0.10, dH + 0.018, -0.05);
    dresser.add(brushHandle);
    const brushHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.025, 0.04),
      mat(0xc28dba, { roughness: 0.8 }),
    );
    brushHead.position.set(0.16, dH + 0.022, -0.05);
    dresser.add(brushHead);
    dresser.position.set(px, 0, pz);
    dresser.rotation.y = -Math.PI / 2;
    scene.add(dresser);
  }

  // (Removed: pink floor pouf — center of room kept clear per user feedback)

  // --- Right-wall fairy lights spanning along the pine wardrobe area ---
  // Photo 2: a second warm-bulb string runs along the right wall above the
  // pine wardrobe / bunny hangers.
  {
    const wallX = ROOM.w / 2 - 0.05;
    const zStart = -ROOM.d / 2 + 0.50;
    const zEnd = ROOM.d / 2 - 1.50;
    const yTop = 2.20;
    const sag = 0.14;
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff3d6, emissive: 0xfff0c4, emissiveIntensity: 0.55, roughness: 0.4,
    });
    const cordMat = mat(0x4a3a32, { roughness: 0.8 });
    const N = 24;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const z = zStart + (zEnd - zStart) * t;
      const sub = (t * 3) % 1;
      const y = yTop - sag * 4 * sub * (1 - sub);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), bulbMat);
      bulb.position.set(wallX, y, z);
      scene.add(bulb);
      if (prev) {
        const dy = y - prev.y, dz = z - prev.z;
        const len = Math.hypot(dy, dz);
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, len, 5),
          cordMat,
        );
        seg.position.set(wallX - 0.005, (y + prev.y) / 2, (z + prev.z) / 2);
        const axis = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3(0, dy, dz).normalize();
        seg.quaternion.setFromUnitVectors(axis, dir);
        scene.add(seg);
      }
      prev = { y, z };
    }
  }

  // --- Extra pillows + folded throw on the lower bunk ---
  // Photo 1: a small heart pillow + a tufted square cushion sit against the
  // headboard, with a folded knit throw at the foot.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const lowerTop = 0.55 + 0.20;
    const heartPillow = new THREE.Group();
    for (const hx of [-0.04, 0.04]) {
      const lobe = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 10, 8),
        mat(0xe88aa6, { roughness: 0.95 }),
      );
      lobe.position.set(hx, 0.01, 0);
      lobe.scale.set(0.9, 0.7, 0.6);
      heartPillow.add(lobe);
    }
    const point = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.07, 4),
      mat(0xe88aa6, { roughness: 0.95 }),
    );
    point.rotation.x = Math.PI;
    point.position.set(0, -0.04, 0);
    point.scale.set(1.2, 1.0, 0.7);
    heartPillow.add(point);
    heartPillow.position.set(bedX + 0.15, lowerTop + 0.04, bedZ - bedL / 2 + 0.55);
    heartPillow.rotation.y = 0.3;
    scene.add(heartPillow);
    const sqPillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.07, 0.16),
      mat(0xfff3d6, { roughness: 0.95 }),
    );
    sqPillow.position.set(bedX - 0.05, lowerTop + 0.05, bedZ - bedL / 2 + 0.42);
    sqPillow.rotation.y = -0.2;
    sqPillow.castShadow = true;
    scene.add(sqPillow);
    for (const cx of [-0.10, 0.10]) {
      const tuft = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 6),
        mat(0xf4a8b8, { roughness: 0.95 }),
      );
      tuft.position.set(bedX - 0.05 + cx * 0.95, lowerTop + 0.085, bedZ - bedL / 2 + 0.42);
      scene.add(tuft);
    }
    const throwBlanket = new THREE.Mesh(
      new THREE.BoxGeometry(bedW - 0.12, 0.06, 0.32),
      mat(0xc28dba, { roughness: 0.95 }),
    );
    throwBlanket.position.set(bedX, lowerTop + 0.04, bedZ + bedL / 2 - 0.40);
    throwBlanket.castShadow = true;
    scene.add(throwBlanket);
    for (let i = 0; i < 4; i++) {
      const stitch = new THREE.Mesh(
        new THREE.BoxGeometry(bedW - 0.16, 0.003, 0.005),
        mat(0xa874b0, { roughness: 0.9 }),
      );
      stitch.position.set(bedX, lowerTop + 0.07, bedZ + bedL / 2 - 0.55 + i * 0.10);
      scene.add(stitch);
    }
  }

  // --- Colorful 3x2 cube storage on lower bunk (toy cubbies with bright fronts) ---
  // Photo 2: a clear 3x2 grid of pastel-color cubbies serves as a toy organizer
  // on the lower bunk play surface.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const lowerTop = 0.55 + 0.20;
    const ux = bedX + 0.15;
    const uz = bedZ + bedL / 2 - 1.10;
    const cellW = 0.16, cellH = 0.16, depth = 0.18;
    const cols = 3, rows = 2;
    const totalW = cellW * cols;
    const totalH = cellH * rows;
    const frameMat = mat(0xfffaf2, { roughness: 0.85 });
    // White frame body
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(depth, totalH + 0.04, totalW + 0.04),
      frameMat,
    );
    frame.position.set(ux, lowerTop + totalH / 2, uz);
    frame.castShadow = true;
    scene.add(frame);
    // Colored cubby fronts
    const cubeColors = [0xe97a8c, 0xf2c14e, 0x88b774, 0x6cb6d6, 0xc28dba, 0xf4a8b8];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const front = new THREE.Mesh(
          new THREE.BoxGeometry(0.012, cellH - 0.025, cellW - 0.025),
          mat(cubeColors[idx], { roughness: 0.85 }),
        );
        front.position.set(
          ux + depth / 2 - 0.004,
          lowerTop + cellH / 2 + r * cellH,
          uz - totalW / 2 + cellW / 2 + c * cellW,
        );
        scene.add(front);
        // Tiny round handle hole
        const handle = new THREE.Mesh(
          new THREE.CircleGeometry(0.015, 14),
          mat(0xfffaf2, { roughness: 0.6 }),
        );
        handle.rotation.y = Math.PI / 2;
        handle.position.set(
          ux + depth / 2 + 0.003,
          lowerTop + cellH / 2 + r * cellH + 0.03,
          uz - totalW / 2 + cellW / 2 + c * cellW,
        );
        scene.add(handle);
      }
    }
  }

  // --- Pink play castle on the lower bunk (foot end, play area) ---
  // Photo 2: a tall pink play castle with turrets + windows sits on the
  // lower bunk's play surface near the foot.
  {
    const bedW = 1.0, bedL = 2.4;
    const bedX = -ROOM.w / 2 + bedW / 2 + 0.05;
    const bedZ = -ROOM.d / 2 + bedL / 2 + 0.05;
    const lowerTop = 0.55 + 0.20;
    const castle = new THREE.Group();
    const pinkMat = mat(0xf4a8b8, { roughness: 0.9 });
    const darkPinkMat = mat(0xd97b8a, { roughness: 0.9 });
    const trimMat = mat(0xfae0d5, { roughness: 0.9 });
    // Main body — wider lower section
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.40, 0.32, 0.30),
      pinkMat,
    );
    body.position.y = 0.16;
    body.castShadow = true;
    castle.add(body);
    // Front door
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.16, 0.005),
      darkPinkMat,
    );
    door.position.set(0, 0.10, 0.152);
    castle.add(door);
    // Arched door top
    const arch = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 12, 8, 0, Math.PI),
      darkPinkMat,
    );
    arch.scale.set(1, 0.6, 0.2);
    arch.rotation.x = -Math.PI / 2;
    arch.position.set(0, 0.18, 0.152);
    castle.add(arch);
    // Two square windows on body
    for (const wx of [-0.13, 0.13]) {
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.005),
        mat(0x9ac4e9, { roughness: 0.8 }),
      );
      win.position.set(wx, 0.20, 0.152);
      castle.add(win);
    }
    // Two side towers — taller cylinders
    for (const tx of [-0.22, 0.22]) {
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.40, 14),
        pinkMat,
      );
      tower.position.set(tx, 0.20, 0);
      tower.castShadow = true;
      castle.add(tower);
      // Tower roof (cone)
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.085, 0.12, 14),
        darkPinkMat,
      );
      roof.position.set(tx, 0.46, 0);
      castle.add(roof);
      // Tiny flag on top
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.05, 0.005),
        mat(0x3a2e2a),
      );
      flag.position.set(tx, 0.54, 0);
      castle.add(flag);
      const flagPiece = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.025, 0.003),
        mat(0xe96b6b),
      );
      flagPiece.position.set(tx + 0.025, 0.55, 0);
      castle.add(flagPiece);
      // Small window on tower
      const tw = new THREE.Mesh(
        new THREE.CircleGeometry(0.018, 12),
        mat(0x9ac4e9, { roughness: 0.7 }),
      );
      tw.position.set(tx, 0.28, 0.072);
      castle.add(tw);
    }
    // Center tower (slightly taller)
    const centerTower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.30, 14),
      pinkMat,
    );
    centerTower.position.set(0, 0.42, -0.08);
    castle.add(centerTower);
    const centerRoof = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.12, 14),
      darkPinkMat,
    );
    centerRoof.position.set(0, 0.61, -0.08);
    castle.add(centerRoof);
    // Crenelations along front top (4 small cubes)
    for (let i = 0; i < 4; i++) {
      const battle = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.04),
        trimMat,
      );
      battle.position.set(-0.16 + i * 0.10, 0.34, 0.14);
      castle.add(battle);
    }
    castle.position.set(bedX + 0.05, lowerTop, bedZ + bedL / 2 - 0.55);
    castle.rotation.y = 0.25;
    scene.add(castle);
  }

  // --- Scattered play food next to the play kitchen ---
  // A few colorful "food" items on the floor near the kitchen, like a
  // toddler left them mid-play.
  {
    const kx = 1.10, kz = 1.95;
    const items = [
      { x: kx - 0.45, z: kz - 0.20, color: 0xe96b6b, geo: 'sphere', s: 0.05 },
      { x: kx - 0.55, z: kz + 0.10, color: 0xf4d55c, geo: 'cyl',    s: 0.04 },
      { x: kx - 0.30, z: kz + 0.30, color: 0x8aa68a, geo: 'sphere', s: 0.045 },
      { x: kx - 0.65, z: kz - 0.05, color: 0xfffaf2, geo: 'box',    s: 0.05 },
      { x: kx - 0.20, z: kz - 0.35, color: 0xf4a261, geo: 'sphere', s: 0.04 },
    ];
    for (const it of items) {
      let mesh;
      if (it.geo === 'sphere') {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(it.s, 10, 8),
          mat(it.color, { roughness: 0.85 }),
        );
      } else if (it.geo === 'cyl') {
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(it.s, it.s, it.s * 1.4, 10),
          mat(it.color, { roughness: 0.85 }),
        );
      } else {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(it.s * 1.4, it.s * 0.8, it.s),
          mat(it.color, { roughness: 0.85 }),
        );
      }
      mesh.position.set(it.x, it.s / 2 + 0.005, it.z);
      mesh.rotation.y = Math.random() * Math.PI;
      mesh.castShadow = true;
      scene.add(mesh);
    }
  }
}

}  // end ROOM CONTENTS ARCHIVE

// ============================================================
//  Bunk bed (along left wall, headboard at FRONT-LEFT corner)
// ============================================================
{
  const bedW = 1.0;
  const bedL = 2.4;
  const lowerY = 0.55;
  const upperY = 1.45;

  const bunk = new THREE.Group();
  const woodMat = mat(PAL.bedWhite, { roughness: 0.7 });
  const pinkMat = mat(PAL.pinkSheet, { roughness: 0.95 });
  const accentMat = mat(PAL.bedAccent, { roughness: 0.95 });

  function slab(w, h, d, m = woodMat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  // Upper bunk has a real mattress; the lower bunk is converted into a play
  // area, so it only gets a thin wooden play platform (no mattress).
  const upperMat = slab(bedW - 0.1, 0.15, bedL - 0.1, accentMat);
  upperMat.position.y = upperY;
  bunk.add(upperMat);
  const playFloor = slab(bedW - 0.12, 0.04, bedL - 0.12, mat(PAL.wood, { roughness: 0.85 }));
  playFloor.position.y = lowerY - 0.05;   // a bit below where a mattress would sit
  bunk.add(playFloor);

  // 4 corner posts
  const postOffsets = [
    [-bedW / 2 + 0.05, -bedL / 2 + 0.05],
    [-bedW / 2 + 0.05,  bedL / 2 - 0.05],
    [ bedW / 2 - 0.05, -bedL / 2 + 0.05],
    [ bedW / 2 - 0.05,  bedL / 2 - 0.05],
  ];
  for (const [px, pz] of postOffsets) {
    const post = slab(0.08, 2.0, 0.08);
    post.position.set(px, 1.0, pz);
    bunk.add(post);
  }

  // Upper rail (room-facing side) + vertical slats — span the head half only
  // so the ladder on the foot half has a clear opening to the upper bunk.
  const railHeadEnd = bedL / 2 - 0.025;
  const railFootEnd = -0.55; // leave the foot half open for the ladder
  const railSpan = railHeadEnd - railFootEnd;
  const rail = slab(0.05, 0.4, railSpan);
  rail.position.set(bedW / 2 - 0.05, upperY + 0.4, (railHeadEnd + railFootEnd) / 2);
  bunk.add(rail);
  const slatCount = 5;
  for (let i = 0; i < slatCount; i++) {
    const slat = slab(0.04, 0.36, 0.04);
    const sz = railFootEnd + (i + 0.5) * railSpan / slatCount;
    slat.position.set(bedW / 2 - 0.05, upperY + 0.4, sz);
    bunk.add(slat);
  }

  // Side rails on lower bed
  const lowerRailFront = slab(0.05, 0.18, bedL - 0.05);
  lowerRailFront.position.set(bedW / 2 - 0.05, lowerY - 0.07, 0);
  bunk.add(lowerRailFront);
  const lowerRailBack = lowerRailFront.clone();
  lowerRailBack.position.x = -bedW / 2 + 0.05;
  bunk.add(lowerRailBack);

  // Headboard at +Z end (against front wall)
  const headboard = slab(bedW, 0.7, 0.05);
  headboard.position.set(0, lowerY + 0.25, bedL / 2 + 0.02);
  bunk.add(headboard);

  // Footboard at -Z end (short panel under upper bunk)
  const footboard = slab(bedW, 0.45, 0.05);
  footboard.position.set(0, upperY + 0.2, -bedL / 2 - 0.02);
  bunk.add(footboard);

  // Ladder on the +X (room-facing) long side, positioned at the foot half of
  // the bed so it's accessible from the middle of the room.
  const ladderTopY = upperY + 0.45;
  const ladderX = bedW / 2 + 0.10;          // just outboard of the bed face
  const ladderCenterZ = -bedL / 2 + 0.35;   // foot end of the long side
  const ladderHalf = 0.22;
  for (const dz of [-ladderHalf, ladderHalf]) {
    const r = slab(0.05, ladderTopY, 0.05);
    r.position.set(ladderX, ladderTopY / 2, ladderCenterZ + dz);
    bunk.add(r);
  }
  for (let i = 0; i < 4; i++) {
    const rung = slab(0.04, 0.04, ladderHalf * 2 + 0.05);
    rung.position.set(ladderX, 0.25 + i * 0.30, ladderCenterZ);
    bunk.add(rung);
  }

  // Pillow on upper bunk (front end, against headboard)
  const upperPillow = slab(bedW - 0.2, 0.10, 0.35, pinkMat);
  upperPillow.position.set(0, upperY + 0.13, bedL / 2 - 0.3);
  bunk.add(upperPillow);

  // Proper flat blanket on the UPPER bunk: a thin slab covering most of the
  // mattress (foot end up to just short of the pillow), plus a folded-back
  // edge showing the lighter inside. Grouped so the whole thing lifts together
  // when tapped, revealing letter O underneath.
  {
    const blanketMat = mat(PAL.blanketPink, { roughness: 0.95 });
    const foldMat = mat(PAL.bedWhite, { roughness: 0.95 });
    const bLen = 1.55;
    const bZ = -0.20; // centered on foot half
    const blanketGrp = new THREE.Group();
    const blanket = slab(bedW - 0.06, 0.04, bLen, blanketMat);
    blanket.position.set(0, upperY + 0.10, bZ);
    blanketGrp.add(blanket);
    // Folded-back top edge (a 0.18 strip showing the underside)
    const fold = slab(bedW - 0.06, 0.045, 0.18, foldMat);
    fold.position.set(0, upperY + 0.12, bZ + bLen / 2 - 0.06);
    blanketGrp.add(fold);
    // A small lump/wrinkle near the foot to break the rigid look
    const wrinkle = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 12, 8),
      blanketMat,
    );
    wrinkle.scale.set(1.6, 0.35, 1.4);
    wrinkle.position.set(0.05, upperY + 0.14, bZ - bLen / 2 + 0.25);
    blanketGrp.add(wrinkle);
    bunk.add(blanketGrp);
    // Hidden letter O under the blanket
    const letterO = buildLetter('O', 'O');
    letterO.position.set(0, upperY + 0.10, bZ - 0.2);
    letterO.visible = false;
    bunk.add(letterO);
    registerHidden(blanketGrp, letterO, 'lift', { label: 'Filten' });
  }

  // ----- Lower-bunk PLAY AREA: dollhouse + toys on the wooden play floor -----
  const playY = lowerY - 0.03;  // top of play platform (4cm slab centered at lowerY-0.05)
  {
    // Dollhouse: cream walls, pink roof, blue windows, brown door.
    const dollhouse = new THREE.Group();
    const wallM = mat(0xfaf0e6, { roughness: 0.85 });
    const roofM = mat(0xd97b8a, { roughness: 0.85 });
    const trimM = mat(0xfff5fa, { roughness: 0.7 });

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.42, 0.30),
      wallM,
    );
    base.position.y = 0.21;
    base.castShadow = true; base.receiveShadow = true;
    dollhouse.add(base);

    // Pitched roof (four-sided cone)
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(0.27, 0.16, 4),
      roofM,
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.50;
    roof.castShadow = true;
    dollhouse.add(roof);

    // Door (front face = +Z)
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(0.085, 0.16),
      mat(0x8a5a3b, { roughness: 0.7 }),
    );
    door.position.set(0, 0.08, 0.151);
    dollhouse.add(door);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 6),
      mat(0xcfa370),
    );
    knob.position.set(0.025, 0.08, 0.152);
    dollhouse.add(knob);

    // Two front windows (above the door)
    for (const sx of [-0.10, 0.10]) {
      const winFrame = new THREE.Mesh(
        new THREE.PlaneGeometry(0.075, 0.075),
        trimM,
      );
      winFrame.position.set(sx, 0.27, 0.151);
      dollhouse.add(winFrame);
      const winGlass = new THREE.Mesh(
        new THREE.PlaneGeometry(0.055, 0.055),
        mat(0x9ac4e9, { roughness: 0.55 }),
      );
      winGlass.position.set(sx, 0.27, 0.152);
      dollhouse.add(winGlass);
    }
    // Side window (left side = -X)
    const sideWin = new THREE.Mesh(
      new THREE.PlaneGeometry(0.07, 0.07),
      mat(0x9ac4e9, { roughness: 0.55 }),
    );
    sideWin.rotation.y = -Math.PI / 2;
    sideWin.position.set(-0.171, 0.22, 0);
    dollhouse.add(sideWin);

    const dollhouseX = 0.05;
    const dollhouseZ = bedL / 2 - 0.55;
    dollhouse.position.set(dollhouseX, playY, dollhouseZ);
    bunk.add(dollhouse);
    // Hidden letter E under the dollhouse
    const letterE = buildLetter('E', 'E');
    letterE.position.set(dollhouseX, playY + 0.11, dollhouseZ);
    letterE.visible = false;
    bunk.add(letterE);
    registerHidden(dollhouse, letterE, 'lift', { label: 'Dockhus' });
  }

  // Tea set: tiny teapot + two cups on a saucer area
  {
    const tea = new THREE.Group();
    const cupMat = mat(0xfff5fa, { roughness: 0.7 });
    const accent = mat(0xe9a8bf, { roughness: 0.7 });

    // Teapot body
    const pot = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 14, 10),
      cupMat,
    );
    pot.scale.set(1.2, 0.9, 1.2);
    pot.position.y = 0.045;
    pot.castShadow = true;
    tea.add(pot);
    // Lid
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 10, 6),
      accent,
    );
    lid.position.y = 0.092;
    tea.add(lid);
    // Spout
    const spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.014, 0.05, 10),
      cupMat,
    );
    spout.rotation.z = -1.0;
    spout.position.set(0.055, 0.055, 0);
    tea.add(spout);
    // Handle (half-torus)
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.020, 0.006, 8, 14, Math.PI),
      cupMat,
    );
    handle.position.set(-0.052, 0.045, 0);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.z = -Math.PI / 2;
    tea.add(handle);

    // Two cups
    for (const cx of [0.12, 0.20]) {
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.018, 0.035, 12),
        cupMat,
      );
      cup.position.set(cx, 0.020, 0);
      tea.add(cup);
      const cupBand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0225, 0.0225, 0.005, 12),
        accent,
      );
      cupBand.position.set(cx, 0.030, 0);
      tea.add(cupBand);
    }

    const teaX = -0.18;
    const teaZ = 0.20;
    tea.position.set(teaX, playY, teaZ);
    bunk.add(tea);
    // Hidden letter L under the teapot
    const letterL2 = buildLetter('L2', 'L');
    letterL2.position.set(teaX + 0.02, playY + 0.07, teaZ);
    letterL2.visible = false;
    bunk.add(letterL2);
    registerHidden(tea, letterL2, 'lift', { label: 'Teservis' });
  }

  // Small stuffed cat figurine
  {
    const cat = new THREE.Group();
    const fur = mat(0xe9c46a, { roughness: 1.0 });
    const stripe = mat(0xc28d5a, { roughness: 1.0 });
    const eye = mat(0x2a1f1c);

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), fur);
    body.scale.set(1.4, 0.8, 1.0);
    body.position.y = 0.045;
    body.castShadow = true;
    cat.add(body);
    // A couple of darker stripes
    for (const sx of [-0.04, 0.02]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), stripe);
      s.position.set(sx, 0.075, 0);
      s.scale.set(2.0, 0.4, 1.4);
      cat.add(s);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), fur);
    head.position.set(0.07, 0.085, 0);
    head.castShadow = true;
    cat.add(head);
    // Ears (small cones)
    for (const ex of [0.045, 0.095]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.03, 6), fur);
      ear.position.set(ex, 0.122, 0);
      cat.add(ear);
    }
    // Eyes
    for (const ez of [-0.020, 0.020]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6), eye);
      e.position.set(0.103, 0.092, ez);
      cat.add(e);
    }
    // Nose (tiny pink triangle = small sphere)
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), mat(0xe9a8bf));
    nose.position.set(0.114, 0.082, 0);
    cat.add(nose);
    // Tail
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.006, 0.10, 8), fur);
    tail.rotation.z = 0.9;
    tail.position.set(-0.085, 0.07, 0);
    cat.add(tail);

    cat.position.set(0.12, playY, -0.20);
    bunk.add(cat);
    tapWiggle(cat, 660, 'Katt', { sway: 0.30, lift: 0.04 });
  }

  // Little play mat / tiny rug
  {
    const mat1 = mat(0xc28dba, { roughness: 0.95 });
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 24),
      mat1,
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.05, playY + 0.005, -0.05);
    rug.receiveShadow = true;
    bunk.add(rug);
  }

  // A couple of building blocks for play — each block taps with its own pitch
  {
    const cols = [0x9ac4e9, 0xe9c46a, 0xd97b8a];
    const freqs = [523, 659, 784]; // C5 E5 G5 — major triad
    for (let i = 0; i < 3; i++) {
      const blk = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.07),
        mat(cols[i], { roughness: 0.85 }),
      );
      blk.position.set(-0.18 + i * 0.02, playY + 0.035, -0.85);
      blk.rotation.y = (i % 2) * 0.25;
      blk.castShadow = true;
      bunk.add(blk);
      tapWiggle(blk, freqs[i], 'Kloss', { sway: 0.35, lift: 0.06, duration: 380 });
    }
  }

  // Rag doll sitting against the wall (back -X side)
  {
    const doll = new THREE.Group();
    const skin = mat(0xf5e4cf, { roughness: 0.9 });
    const dress = mat(0xe55f7a, { roughness: 0.85 });
    const hair = mat(0xc28d6a, { roughness: 1.0 });
    const body5 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), dress);
    body5.position.y = 0.04;
    body5.castShadow = true;
    doll.add(body5);
    const head3 = new THREE.Mesh(new THREE.SphereGeometry(0.030, 12, 10), skin);
    head3.position.y = 0.11;
    doll.add(head3);
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), hair);
    hairMesh.position.set(0, 0.118, -0.005);
    hairMesh.scale.set(1.0, 0.85, 1.05);
    doll.add(hairMesh);
    // Two pigtails
    for (const sx of [-0.030, 0.030]) {
      const pig = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), hair);
      pig.position.set(sx, 0.10, 0);
      pig.scale.set(0.9, 1.5, 0.9);
      doll.add(pig);
    }
    // Eyes
    for (const sx of [-0.010, 0.010]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 6, 6), mat(0x2a1f1c));
      e.position.set(sx, 0.115, 0.025);
      doll.add(e);
    }
    // Legs
    for (const sx of [-0.014, 0.014]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.02), skin);
      leg.position.set(sx, -0.005, 0);
      doll.add(leg);
    }
    // Arms
    for (const sx of [-0.040, 0.040]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.02), skin);
      arm.position.set(sx, 0.05, 0);
      arm.rotation.z = sx > 0 ? -0.4 : 0.4;
      doll.add(arm);
    }
    doll.position.set(-0.30, playY + 0.005, 0.40);
    doll.rotation.y = 0.5;
    bunk.add(doll);
    tapWiggle(doll, 740, 'Docka', { sway: 0.3, lift: 0.04, duration: 460 });
  }

  // Toy phone — chunky pink with a yellow handset on top
  {
    const phone = new THREE.Group();
    const body6 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.07), mat(0xe55f7a, { roughness: 0.65 }));
    body6.position.y = 0.02;
    body6.castShadow = true;
    phone.add(body6);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.005, 16), mat(0xfffaf2));
    dial.position.set(-0.015, 0.043, 0);
    phone.add(dial);
    // Holes in dial
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI / 5;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 8), mat(0x2a1f1c));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(-0.015 + Math.cos(a) * 0.016, 0.046, Math.sin(a) * 0.016);
      phone.add(hole);
    }
    // Handset (yellow tube with two ends)
    const handset = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.10, 12), mat(0xf5d547, { roughness: 0.6 }));
    handset.rotation.z = Math.PI / 2;
    handset.position.set(0, 0.06, 0.025);
    phone.add(handset);
    for (const sx of [-0.046, 0.046]) {
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), mat(0xf5d547));
      end.position.set(sx, 0.06, 0.025);
      end.scale.set(0.8, 1.0, 1.0);
      phone.add(end);
    }
    // Wheels (it's a pull-along phone toy)
    for (const sx of [-0.040, 0.040]) {
      for (const sz of [-0.025, 0.025]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 10), mat(0x2a1f1c));
        w.rotation.z = Math.PI / 2;
        w.position.set(sx, 0.008, sz);
        phone.add(w);
      }
    }
    phone.position.set(0.20, playY + 0.005, 0.45);
    phone.rotation.y = -0.4;
    bunk.add(phone);
    tapWiggle(phone, 587, 'Leksakstelefon', { sway: 0.35, lift: 0.05, duration: 480 });
  }

  // Mini xylophone — 5 colorful metal bars on a wood frame, with mallet
  {
    const xy = new THREE.Group();
    const frameM = mat(PAL.wood, { roughness: 0.75 });
    const fL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.012), frameM);
    fL.position.set(0, 0.015, -0.045);
    xy.add(fL);
    const fR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.012), frameM);
    fR.position.set(0, 0.015, 0.045);
    xy.add(fR);
    const barCols = [0xe55f7a, 0xf2a93a, 0xf5d547, 0x6cc24a, 0x4a90e2];
    for (let i = 0; i < barCols.length; i++) {
      const w = 0.022 - i * 0.001;
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.008, 0.10),
        mat(barCols[i], { roughness: 0.4, metalness: 0.55 }),
      );
      bar.position.set(-0.06 + i * 0.030, 0.026, 0);
      bar.castShadow = true;
      xy.add(bar);
    }
    // Mallet
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.10, 6), frameM);
    stick.rotation.z = Math.PI / 2;
    stick.position.set(0.10, 0.026, 0.06);
    xy.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.010, 8, 6), mat(0xc28d6a));
    knob.position.set(0.150, 0.026, 0.06);
    xy.add(knob);
    xy.position.set(-0.15, playY + 0.005, -0.55);
    xy.rotation.y = 0.15;
    bunk.add(xy);
    tapWiggle(xy, 1175, 'Xylofon', { sway: 0.20, lift: 0.03, duration: 450 });
  }

  // Frame body for the blocking AABB
  const frameBody = new THREE.Mesh(
    new THREE.BoxGeometry(bedW, 1.85, bedL),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  frameBody.position.y = 1.0;
  bunk.add(frameBody);

  placeObject(bunk, {
    name: 'bunkBed',
    x: -ROOM.w / 2 + bedW / 2,
    z: ROOM.d / 2 - bedL / 2,
    blocking: frameBody,
  });
}

// ============================================================
//  Round raccoon rug (signature floor piece — center of room)
// ============================================================
{
  const rug = new THREE.Group();
  const rugR = 0.72;

  // Cream base disc
  const base = new THREE.Mesh(
    new THREE.CircleGeometry(rugR, 40),
    mat(0xfaf6ee, { roughness: 0.98 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.012;
  base.receiveShadow = true;
  rug.add(base);

  // Gray raccoon face oval
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(rugR * 0.42, 32),
    mat(0xbfb0a0, { roughness: 0.98 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.014;
  face.scale.set(1.0, 0.85, 1.0);
  rug.add(face);

  // Pink nose
  const nose = new THREE.Mesh(
    new THREE.CircleGeometry(0.055, 3),
    mat(0xf6cfcb, { roughness: 0.95 }),
  );
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.z = Math.PI;
  nose.position.set(0, 0.016, 0.04);
  rug.add(nose);

  // Eye patches + white dots (the raccoon mask)
  for (const sx of [-0.13, 0.13]) {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(0.075, 18),
      mat(0x3a2e2a, { roughness: 0.98 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(sx, 0.015, -0.04);
    patch.scale.set(1.0, 0.75, 1.0);
    rug.add(patch);
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.026, 14),
      mat(0xfffaf2, { roughness: 0.95 }),
    );
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(sx, 0.016, -0.04);
    rug.add(dot);
  }

  // Dark ears
  for (const sx of [-0.24, 0.24]) {
    const ear = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 18),
      mat(0x6a5a52, { roughness: 0.98 }),
    );
    ear.rotation.x = -Math.PI / 2;
    ear.position.set(sx, 0.015, -0.24);
    ear.scale.set(1.0, 0.8, 1.0);
    rug.add(ear);
  }

  // Striped tail ring around the edge (alternating dark/light arcs)
  for (let i = 0; i < 6; i++) {
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(rugR * 0.78, rugR * 0.95, 24, 1, (i / 6) * Math.PI * 2, (Math.PI * 2) / 6 - 0.05),
      mat(i % 2 === 0 ? 0x6a5a52 : 0xfaf6ee, { roughness: 0.98 }),
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = 0.013;
    rug.add(arc);
  }

  placeObject(rug, { name: 'rug', x: 0.1, z: 0.4 });
}

// ============================================================
//  Window dressing: pink side curtains + half-pulled white roller blind
// ============================================================
{
  const winW = 1.8, winH = 1.3, winY = 1.55;
  const wz = -ROOM.d / 2 + 0.06;

  // Roller blind tube
  const roller = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, winW + 0.08, 12),
    mat(0xece6d6, { roughness: 0.7 }),
  );
  roller.rotation.z = Math.PI / 2;
  roller.position.set(0, winY + winH / 2 + 0.03, wz + 0.025);
  scene.add(roller);

  // Blind fabric — mostly retracted (only 15% of the window covered)
  const fabricH = winH * 0.15;
  const fabric = new THREE.Mesh(
    new THREE.PlaneGeometry(winW + 0.02, fabricH),
    mat(0xfaf6ec, { roughness: 0.95 }),
  );
  fabric.position.set(0, winY + winH / 2 - fabricH / 2, wz + 0.018);
  scene.add(fabric);

  // Bottom weight rod
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, winW + 0.04, 10),
    mat(0xece6d6, { roughness: 0.7 }),
  );
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, winY + winH / 2 - fabricH - 0.005, wz + 0.020);
  scene.add(rod);

  // Center pull tassel
  const tassel = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 8, 6),
    mat(0xfffaf2, { roughness: 0.85 }),
  );
  tassel.position.set(0, winY + winH / 2 - fabricH - 0.04, wz + 0.026);
  scene.add(tassel);

  // Pink side curtains — pulled wider so more of the window is visible
  const curtainMat = mat(0xf4c8c8, { roughness: 0.98 });
  const pleatMat = mat(0xe9b0b0, { roughness: 0.95 });
  for (const sx of [-(winW / 2 + 0.32), (winW / 2 + 0.32)]) {
    const curtain = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 1.4, 0.04),
      curtainMat,
    );
    curtain.position.set(sx, 1.7, wz - 0.02);
    curtain.castShadow = true;
    scene.add(curtain);
    for (let i = 0; i < 3; i++) {
      const pleat = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 1.36, 0.005),
        pleatMat,
      );
      pleat.position.set(sx - 0.05 + i * 0.05, 1.7, wz - 0.02 + 0.022);
      scene.add(pleat);
    }
  }

  // Curtain rod across the window
  const curtainRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, winW + 0.7, 10),
    mat(0xcfa370, { roughness: 0.5 }),
  );
  curtainRod.rotation.z = Math.PI / 2;
  curtainRod.position.set(0, 2.42, wz - 0.02);
  scene.add(curtainRod);
}

// ============================================================
//  White 3-drawer dresser (left wall, back half — behind the bed footboard)
// ============================================================
{
  const dresser = new THREE.Group();
  const dresserMat = mat(PAL.bedWhite, { roughness: 0.7 });

  // Body: 0.55 wide (X) × 0.85 tall (Y) × 1.20 long (Z)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 1.20), dresserMat);
  body.position.y = 0.43;
  body.castShadow = true; body.receiveShadow = true;
  dresser.add(body);

  // 3 drawers, fronts facing +X (toward room interior)
  for (let i = 0; i < 3; i++) {
    const drawer = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.24, 1.12),
      mat(0xfffaf2, { roughness: 0.7 }),
    );
    drawer.position.set(0.28, 0.16 + i * 0.27, 0);
    dresser.add(drawer);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 10, 8),
      mat(0xcfa370, { roughness: 0.5 }),
    );
    knob.position.set(0.295, 0.16 + i * 0.27, 0);
    dresser.add(knob);
  }

  // Small plant pot on top
  {
    const potGrp = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.1, 12),
      mat(0xc28dba, { roughness: 0.85 }),
    );
    pot.position.set(0.05, 0.91, -0.3);
    pot.castShadow = true;
    potGrp.add(pot);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 6),
        mat(0x8aa68a, { roughness: 0.9 }),
      );
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(0.05 + Math.cos(a) * 0.04, 1.00 + (i % 2) * 0.025, -0.3 + Math.sin(a) * 0.04);
      leaf.scale.set(1.2, 0.7, 1.0);
      potGrp.add(leaf);
    }
    dresser.add(potGrp);
    tapWiggle(potGrp, 392, 'Krukväxt', { sway: 0.12, lift: 0.02 });
  }

  // Alarm clock — pink dome with little legs and bells
  {
    const clk = new THREE.Group();
    const face = mat(0xfdfcf8, { roughness: 0.55 });
    const shell = mat(0xe55f7a, { roughness: 0.55 });
    const metal = mat(0xcfa370, { roughness: 0.45 });
    const body2 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), shell);
    body2.scale.set(1.0, 0.8, 0.55);
    body2.position.set(0.05, 0.95, 0.10);
    body2.castShadow = true;
    clk.add(body2);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.045, 18), face);
    dial.position.set(0.05, 0.95, 0.135);
    clk.add(dial);
    // Hour + minute hand
    for (const [len, ang, w] of [[0.025, 1.1, 0.005], [0.038, -0.4, 0.004]]) {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.003), mat(0x2a1f1c));
      hand.position.set(0.05 + Math.sin(ang) * len / 2, 0.95 + Math.cos(ang) * len / 2, 0.137);
      hand.rotation.z = -ang;
      clk.add(hand);
    }
    // Bells on top
    for (const sx of [-0.045, 0.045]) {
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), metal);
      bell.position.set(0.05 + sx, 1.01, 0.10);
      clk.add(bell);
    }
    // Little legs
    for (const sx of [-0.04, 0.04]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.025, 6), metal);
      leg.position.set(0.05 + sx, 0.88, 0.13);
      leg.rotation.z = sx > 0 ? -0.4 : 0.4;
      clk.add(leg);
    }
    dresser.add(clk);
    tapWiggle(clk, 1318, 'Väckarklocka', { sway: 0.4, lift: 0.03, duration: 380 });
  }

  // Jewelry box — pink lid with heart latch
  {
    const jbox = new THREE.Group();
    const boxMat = mat(0xf4c5cd, { roughness: 0.75 });
    const trim = mat(0xcfa370, { roughness: 0.5 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.10), boxMat);
    base.position.set(0.0, 0.88, 0.40);
    base.castShadow = true;
    jbox.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.10), boxMat);
    lid.position.set(0.0, 0.925, 0.40);
    jbox.add(lid);
    // Heart on lid
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), mat(0xe55f7a));
    heart.scale.set(1.0, 0.35, 1.0);
    heart.position.set(0.0, 0.945, 0.40);
    jbox.add(heart);
    // Trim band
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.008, 0.103), trim);
    band.position.set(0.0, 0.905, 0.40);
    jbox.add(band);
    dresser.add(jbox);
    tapWiggle(jbox, 880, 'Smyckesskrin', { sway: 0.2, lift: 0.04 });
  }

  // Toy robot — silver block body with antenna
  {
    const robot = new THREE.Group();
    const silver = mat(0xc7cdd3, { metalness: 0.5, roughness: 0.45 });
    const accent = mat(0x4a90e2, { roughness: 0.6 });
    const led = mat(0xe55f7a, { emissive: 0xe55f7a, emissiveIntensity: 0.7 });
    const body3 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.10, 0.06), silver);
    body3.position.set(0.10, 0.95, -0.10);
    body3.castShadow = true;
    robot.add(body3);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.05), silver);
    head.position.set(0.10, 1.025, -0.10);
    robot.add(head);
    // Two eyes
    for (const sz of [-0.012, 0.012]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), led);
      eye.position.set(0.10 - 0.026, 1.030, -0.10 + sz);
      robot.add(eye);
    }
    // Antenna
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 6), silver);
    ant.position.set(0.10, 1.075, -0.10);
    robot.add(ant);
    const antBall = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), led);
    antBall.position.set(0.10, 1.10, -0.10);
    robot.add(antBall);
    // Arms
    for (const sz of [-0.040, 0.040]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.06, 0.018), accent);
      arm.position.set(0.10, 0.95, -0.10 + sz);
      robot.add(arm);
    }
    dresser.add(robot);
    tapWiggle(robot, 196, 'Robot', { sway: 0.15, lift: 0.06, duration: 480 });
  }

  // Music box — wooden cube with a hand crank, tiny ballerina on a peg
  {
    const mbox = new THREE.Group();
    const wood = mat(PAL.wood, { roughness: 0.7 });
    const dressM = mat(0xf4c5cd, { roughness: 0.85 });
    const skinM = mat(0xf5e4cf);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.10), wood);
    cube.position.set(0.0, 0.89, 0.10);
    cube.castShadow = true;
    mbox.add(cube);
    // Trim along middle
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.012, 0.105), mat(0xcfa370, { roughness: 0.5 }));
    band.position.set(0.0, 0.89, 0.10);
    mbox.add(band);
    // Hand crank on side
    const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 6), mat(0xcfa370));
    crank.rotation.z = Math.PI / 2;
    crank.position.set(0.07, 0.89, 0.10);
    mbox.add(crank);
    const crankBall = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat(0xcfa370));
    crankBall.position.set(0.092, 0.89, 0.10);
    mbox.add(crankBall);
    // Ballerina figurine on top
    const dressBall = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 12), dressM);
    dressBall.position.set(0.0, 0.96, 0.10);
    mbox.add(dressBall);
    const headBall = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), skinM);
    headBall.position.set(0.0, 1.00, 0.10);
    mbox.add(headBall);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat(0xc28d6a));
    bun.position.set(0.0, 1.018, 0.094);
    mbox.add(bun);
    dresser.add(mbox);
    tapWiggle(mbox, 1047, 'Speldosa', { sway: 0.3, lift: 0.03, duration: 600 });
  }

  placeObject(dresser, {
    name: 'dresser',
    x: -ROOM.w / 2 + 0.32,
    z: -ROOM.d / 2 + 0.65,
    blocking: body,
  });
}

// ============================================================
//  Pine open-cubby shelf (right wall, back half)
// ============================================================
{
  const sd = 0.40;
  const sw = 1.5;
  const sh = 1.80;
  const shelf = new THREE.Group();
  const woodMat = mat(PAL.wood, { roughness: 0.85 });

  // End panels at z = ±sw/2
  for (const dz of [-sw / 2, sw / 2]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(sd, sh, 0.05), woodMat);
    side.position.set(0, sh / 2, dz);
    side.castShadow = true; side.receiveShadow = true;
    shelf.add(side);
  }

  // Back panel against the right wall (+X face)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.03, sh, sw), woodMat);
  back.position.set(sd / 2 - 0.015, sh / 2, 0);
  shelf.add(back);

  // Vertical divider splits cubbies in half along z
  const divider = new THREE.Mesh(new THREE.BoxGeometry(sd - 0.03, sh, 0.04), woodMat);
  divider.position.set(0, sh / 2, 0);
  shelf.add(divider);

  // Horizontal shelves
  const shelfYs = [0.04, 0.55, 1.05, 1.55, 1.78];
  for (const y of shelfYs) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(sd - 0.03, 0.03, sw - 0.05), woodMat);
    board.position.set(0, y, 0);
    board.castShadow = true; board.receiveShadow = true;
    shelf.add(board);
  }

  // Cabinet doors — one tall door per bottom cubby, fronts facing the room.
  // Bottom cubby spans local y=0.04 → 0.55 (≈0.51 tall), x=±sd/2, z split by divider at 0.
  // Front face at local x ≈ -sd/2 (room side, since back panel is at +x).
  {
    const dThick   = 0.025;
    const dHeight  = 0.46;
    const dCubbyW  = (sw / 2) - 0.06;    // length along z of each door face
    const dFaceX   = -sd / 2 + 0.015;    // flush with cubby opening
    const dy       = (0.04 + 0.55) / 2;  // door centered in cubby height
    const pullMat  = mat(0xcfa370, { roughness: 0.5 });
    for (const cz of [-sw / 4, sw / 4]) {        // left cubby, right cubby
      const front = new THREE.Mesh(
        new THREE.BoxGeometry(dThick, dHeight, dCubbyW),
        woodMat,
      );
      front.position.set(dFaceX, dy, cz);
      front.castShadow = true; front.receiveShadow = true;
      shelf.add(front);
      // Knob on the near-divider edge (hinge on the end-panel side)
      const knobZOff = (cz < 0) ? dCubbyW / 2 - 0.04 : -(dCubbyW / 2 - 0.04);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.020, 12, 8),
        pullMat,
      );
      knob.position.set(dFaceX - dThick / 2 - 0.018, dy, cz + knobZOff);
      knob.castShadow = true;
      shelf.add(knob);
    }
  }

  // Figurines on the upper shelves — one per cubby (6 total).
  // Cubby centers: left z=-sw/4 (-0.375), right z=+sw/4 (+0.375).
  // Items sit ON the shelf board at y = shelfY + (board half) + item base offset.
  {
    const cubbyLeft  = -sw / 4;
    const cubbyRight =  sw / 4;
    const figX = -0.04;     // slightly forward of shelf center, room-side

    // Shared tap behavior: short hop + wiggle + chirp.
    const wiggleFig = (grp) => {
      if (grp.userData._wiggling) return;
      grp.userData._wiggling = true;
      const baseRotY = grp.rotation.y;
      const baseY = grp.position.y;
      const start = performance.now();
      const duration = 420;
      (function step() {
        const t = (performance.now() - start) / duration;
        if (t >= 1) {
          grp.rotation.y = baseRotY;
          grp.position.y = baseY;
          grp.userData._wiggling = false;
          return;
        }
        const decay = 1 - t;
        grp.rotation.y = baseRotY + Math.sin(t * Math.PI * 6) * 0.20 * decay;
        grp.position.y = baseY + Math.abs(Math.sin(t * Math.PI * 2)) * 0.05 * decay;
        requestAnimationFrame(step);
      })();
    };
    const tapFig = (grp, freq, label) => {
      registerInteract(grp, () => {
        tone(freq, 0.12, 'triangle');
        tone(freq * 1.5, 0.14, 'triangle', 0.05);
        wiggleFig(grp);
      }, { label });
    };

    // Middle-low left: three books standing upright, lined up along the shelf
    {
      const grp = new THREE.Group();
      const bookCols = [0xd97b8a, 0xe9c46a, 0x9ac4e9];
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.24, 0.05),
          mat(bookCols[i], { roughness: 0.85 }),
        );
        b.position.set(-0.02, 0.12, -0.08 + i * 0.07);
        b.castShadow = true;
        grp.add(b);
      }
      grp.position.set(figX, 0.555, cubbyLeft);
      shelf.add(grp);
      // Hidden letter L1 under the books
      const letterL1 = buildLetter('L1', 'L');
      letterL1.position.set(figX, 0.555 + 0.11, cubbyLeft);
      letterL1.visible = false;
      shelf.add(letterL1);
      registerHidden(grp, letterL1, 'paperLift', { label: 'Böcker' });
    }

    // Middle-low right: teddy bear (round body + head + ears + arms)
    {
      const grp = new THREE.Group();
      const fur = mat(0xc28d6a, { roughness: 1.0 });
      const muzzle = mat(0xf5e4cf, { roughness: 1.0 });
      const eye = mat(0x2a1f1c);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 10), fur);
      body.scale.set(1.0, 0.95, 1.0);
      body.position.y = 0.10;
      body.castShadow = true;
      grp.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), fur);
      head.position.y = 0.235;
      head.castShadow = true;
      grp.add(head);
      for (const ex of [-0.055, 0.055]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), fur);
        ear.position.set(ex, 0.288, 0.01);
        grp.add(ear);
      }
      const sn = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), muzzle);
      sn.position.set(0, 0.225, 0.06);
      grp.add(sn);
      for (const ex of [-0.025, 0.025]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), eye);
        e.position.set(ex, 0.252, 0.068);
        grp.add(e);
      }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), eye);
      nose.position.set(0, 0.233, 0.082);
      grp.add(nose);
      // Arms (small spheres at sides)
      for (const ex of [-0.105, 0.105]) {
        const arm = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), fur);
        arm.position.set(ex, 0.115, 0);
        arm.scale.set(0.9, 1.1, 0.9);
        grp.add(arm);
      }
      grp.rotation.y = -Math.PI / 2;   // face the room (-x)
      grp.position.set(figX, 0.555, cubbyRight);
      shelf.add(grp);
      tapFig(grp, 220, 'Nalle');
    }

    // Middle-high left: bunny (oval body + tall ears)
    {
      const grp = new THREE.Group();
      const fur = mat(0xfaf2e4, { roughness: 1.0 });
      const inside = mat(0xf4c5cd, { roughness: 1.0 });
      const eye = mat(0x2a1f1c);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), fur);
      body.scale.set(1.0, 1.1, 1.0);
      body.position.y = 0.085;
      body.castShadow = true;
      grp.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), fur);
      head.position.y = 0.21;
      head.castShadow = true;
      grp.add(head);
      // Ears (tall capsules approximated as scaled spheres)
      for (const ex of [-0.028, 0.028]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), fur);
        ear.scale.set(0.7, 2.6, 0.7);
        ear.position.set(ex, 0.305, -0.005);
        grp.add(ear);
        const inn = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), inside);
        inn.scale.set(0.6, 2.4, 0.4);
        inn.position.set(ex, 0.305, 0.005);
        grp.add(inn);
      }
      for (const ex of [-0.022, 0.022]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 6), eye);
        e.position.set(ex, 0.222, 0.062);
        grp.add(e);
      }
      // Tail
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), fur);
      tail.position.set(0, 0.105, -0.075);
      grp.add(tail);
      grp.rotation.y = -Math.PI / 2;   // face the room (-x)
      grp.position.set(figX, 1.055, cubbyLeft);
      shelf.add(grp);
      tapFig(grp, 880, 'Kanin');
    }

    // Middle-high right: stack of three building blocks (pastel cubes)
    {
      const grp = new THREE.Group();
      const blockCols = [0x9ac4e9, 0xe9c46a, 0xc28dba];
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.11, 0.11),
          mat(blockCols[i], { roughness: 0.85 }),
        );
        c.position.set((i % 2 === 0 ? -0.015 : 0.02), 0.06 + i * 0.115, (i === 1 ? 0.015 : -0.005));
        c.rotation.y = (i % 2) * 0.18;
        c.castShadow = true;
        grp.add(c);
      }
      grp.position.set(figX, 1.055, cubbyRight);
      shelf.add(grp);
      tapFig(grp, 540, 'Klossar');
    }

    // Top left: small globe / ball on a tiny ring stand
    {
      const grp = new THREE.Group();
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 12),
        mat(0x7fb3c6, { roughness: 0.7 }),
      );
      ball.position.y = 0.10;
      ball.castShadow = true;
      grp.add(ball);
      // Continents (random tan blobs)
      const land = mat(0x8aa68a, { roughness: 0.9 });
      const blobPositions = [
        [ 0.03,  0.13,  0.07],
        [-0.04,  0.10,  0.06],
        [ 0.05,  0.07, -0.05],
        [-0.05,  0.14, -0.03],
      ];
      for (const [x, y, z] of blobPositions) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), land);
        blob.position.set(x, y, z);
        blob.scale.set(1.2, 0.5, 1.2);
        grp.add(blob);
      }
      // Ring stand
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.045, 0.008, 8, 18),
        mat(0xcfa370, { roughness: 0.5 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.02;
      grp.add(ring);
      grp.position.set(figX, 1.555, cubbyLeft);
      shelf.add(grp);
      tapFig(grp, 660, 'Jordglob');
    }

    // Top right: little wooden duck (body + head + bill)
    {
      const grp = new THREE.Group();
      const woodLight = mat(0xe3b885, { roughness: 0.9 });
      const bill = mat(0xe9a23a, { roughness: 0.85 });
      const eye = mat(0x2a1f1c);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), woodLight);
      body.scale.set(1.3, 0.85, 1.0);
      body.position.y = 0.075;
      body.castShadow = true;
      grp.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), woodLight);
      head.position.set(0.07, 0.16, 0);
      head.castShadow = true;
      grp.add(head);
      const beak = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.03), bill);
      beak.position.set(0.12, 0.155, 0);
      grp.add(beak);
      for (const ez of [-0.022, 0.022]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), eye);
        e.position.set(0.095, 0.175, ez);
        grp.add(e);
      }
      // Wheels (it's a pull-toy duck)
      const wheelMat = mat(0xcfa370, { roughness: 0.6 });
      for (const wx of [-0.05, 0.05]) {
        for (const wz of [-0.045, 0.045]) {
          const w = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12),
            wheelMat,
          );
          w.rotation.x = Math.PI / 2;
          w.position.set(wx, 0.022, wz);
          grp.add(w);
        }
      }
      grp.rotation.y = Math.PI;        // face the room (-x); duck head was at +x
      grp.position.set(figX, 1.555, cubbyRight);
      shelf.add(grp);
      tapFig(grp, 820, 'Anka');
    }

    // --- Extra clutter: side items in each cubby to make the shelf feel busy ---

    // Row 2 left, near the back-end panel: small potted cactus
    {
      const grp = new THREE.Group();
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.035, 0.06, 12),
        mat(0xc28dba, { roughness: 0.85 }),
      );
      pot.position.y = 0.03;
      pot.castShadow = true;
      grp.add(pot);
      const cactus = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.030, 0.10, 10),
        mat(0x6fa66a, { roughness: 0.95 }),
      );
      cactus.position.y = 0.11;
      cactus.castShadow = true;
      grp.add(cactus);
      for (const ax of [-0.026, 0.026]) {
        const arm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8),
          mat(0x6fa66a, { roughness: 0.95 }),
        );
        arm.position.set(ax, 0.115, 0);
        arm.rotation.z = ax < 0 ? 0.7 : -0.7;
        grp.add(arm);
      }
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 8, 6),
        mat(0xf4a3b0, { roughness: 0.8 }),
      );
      flower.position.y = 0.17;
      grp.add(flower);
      grp.position.set(figX - 0.01, 0.555, cubbyLeft - 0.22);
      shelf.add(grp);
      // Hidden letter I under the cactus pot
      const letterI = buildLetter('I', 'I');
      letterI.position.set(figX - 0.01, 0.555 + 0.11, cubbyLeft - 0.22);
      letterI.visible = false;
      shelf.add(letterI);
      registerHidden(grp, letterI, 'lift', { label: 'Kaktus' });
    }

    // Row 2 left, near the divider: ball of yarn
    {
      const grp = new THREE.Group();
      const yarn = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 14, 10),
        mat(0xe9a8bf, { roughness: 0.95 }),
      );
      yarn.position.y = 0.055;
      yarn.castShadow = true;
      grp.add(yarn);
      // A few darker rings to suggest wound thread
      const ringMat = mat(0xd47fa0, { roughness: 0.95 });
      for (const rot of [0.3, 1.1, 2.0]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.052, 0.004, 6, 18),
          ringMat,
        );
        ring.rotation.x = Math.PI / 2;
        ring.rotation.z = rot;
        ring.position.y = 0.055;
        grp.add(ring);
      }
      grp.position.set(figX, 0.555, cubbyLeft + 0.22);
      shelf.add(grp);
      tapFig(grp, 700, 'Garnnystan');
    }

    // Row 2 right, near divider: small treasure chest
    {
      const grp = new THREE.Group();
      const woodM = mat(0x8a5a3b, { roughness: 0.7 });
      const trim = mat(0xcfa370, { roughness: 0.5 });
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.08, 0.09),
        woodM,
      );
      base.position.y = 0.04;
      base.castShadow = true;
      grp.add(base);
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.05, 0.09),
        woodM,
      );
      lid.position.set(0, 0.105, 0);
      lid.castShadow = true;
      grp.add(lid);
      const band1 = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.01, 0.092), trim);
      band1.position.y = 0.08;
      grp.add(band1);
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), trim);
      lock.position.set(0, 0.075, -0.048);
      grp.add(lock);
      grp.position.set(figX, 0.555, cubbyRight - 0.22);
      shelf.add(grp);
      // Hidden letter N inside the treasure chest
      const letterN = buildLetter('N', 'N');
      letterN.position.set(figX, 0.555 + 0.11, cubbyRight - 0.22);
      letterN.visible = false;
      shelf.add(letterN);
      registerHidden(grp, letterN, 'flipLid', { label: 'Skattkista' });
    }

    // Row 2 right, near end panel: little soccer ball
    {
      const grp = new THREE.Group();
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 14, 10),
        mat(0xfafafa, { roughness: 0.85 }),
      );
      ball.position.y = 0.05;
      ball.castShadow = true;
      grp.add(ball);
      // A few dark pentagon-ish patches
      const dark = mat(0x2a2a2a, { roughness: 0.9 });
      const patchPositions = [
        [ 0,    0.10,  0.000],
        [ 0.03, 0.05,  0.035],
        [-0.03, 0.05, -0.035],
        [ 0.04, 0.05, -0.025],
      ];
      for (const [x, y, z] of patchPositions) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), dark);
        p.position.set(x, y, z);
        p.scale.set(1.0, 0.4, 1.0);
        grp.add(p);
      }
      grp.position.set(figX, 0.555, cubbyRight + 0.22);
      shelf.add(grp);
      tapFig(grp, 580, 'Fotboll');
    }

    // Row 3 left, near end panel: stack of books lying flat
    {
      const grp = new THREE.Group();
      const cols = [0x7aa9c9, 0xe9a8bf, 0xe9c46a];
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.14 - i * 0.01, 0.025, 0.10 - i * 0.005),
          mat(cols[i], { roughness: 0.85 }),
        );
        b.position.set(0, 0.013 + i * 0.026, (i % 2) * 0.006);
        b.castShadow = true;
        grp.add(b);
      }
      grp.position.set(figX, 1.055, cubbyLeft - 0.22);
      shelf.add(grp);
      tapFig(grp, 900, 'Bokstapel');
    }

    // Row 3 left, near divider: small mug with handle
    {
      const grp = new THREE.Group();
      const mugMat = mat(0xfffaf2, { roughness: 0.7 });
      const accent = mat(0xd97b8a, { roughness: 0.7 });
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.030, 0.08, 14),
        mugMat,
      );
      cup.position.y = 0.04;
      cup.castShadow = true;
      grp.add(cup);
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0355, 0.0355, 0.012, 14),
        accent,
      );
      stripe.position.y = 0.06;
      grp.add(stripe);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.020, 0.006, 8, 14, Math.PI),
        mugMat,
      );
      handle.position.set(0.040, 0.04, 0);
      handle.rotation.y = Math.PI / 2;
      handle.rotation.z = -Math.PI / 2;
      grp.add(handle);
      grp.position.set(figX, 1.055, cubbyLeft + 0.22);
      shelf.add(grp);
      tapFig(grp, 480, 'Mugg');
    }

    // Row 3 right, near divider: flower in a tiny vase
    {
      const grp = new THREE.Group();
      const vase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.028, 0.10, 12),
        mat(0x7fb3c6, { roughness: 0.6 }),
      );
      vase.position.y = 0.05;
      vase.castShadow = true;
      grp.add(vase);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.10, 6),
        mat(0x6fa66a, { roughness: 0.95 }),
      );
      stem.position.y = 0.13;
      grp.add(stem);
      const flowerMat = mat(0xe9a23a, { roughness: 0.8 });
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 10, 8),
        flowerMat,
      );
      center.position.y = 0.18;
      grp.add(center);
      const petalMat = mat(0xf4c5cd, { roughness: 0.85 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), petalMat);
        p.position.set(Math.cos(a) * 0.024, 0.18, Math.sin(a) * 0.024);
        p.scale.set(1.0, 0.4, 1.0);
        grp.add(p);
      }
      grp.position.set(figX, 1.055, cubbyRight - 0.22);
      shelf.add(grp);
      tapFig(grp, 1100, 'Blomma');
    }

    // Row 3 right, near end panel: little red toy car
    {
      const grp = new THREE.Group();
      const bodyM = mat(0xd14a4a, { roughness: 0.6 });
      const cabM  = mat(0xf4c5cd, { roughness: 0.6 });
      const wheelM = mat(0x2a1f1c, { roughness: 0.8 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.075), bodyM);
      base.position.y = 0.045;
      base.castShadow = true;
      grp.add(base);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.035, 0.07), cabM);
      cab.position.set(-0.005, 0.085, 0);
      cab.castShadow = true;
      grp.add(cab);
      for (const wx of [-0.055, 0.055]) {
        for (const wz of [-0.04, 0.04]) {
          const w = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12),
            wheelM,
          );
          w.rotation.x = Math.PI / 2;
          w.position.set(wx, 0.022, wz);
          grp.add(w);
        }
      }
      grp.position.set(figX, 1.055, cubbyRight + 0.22);
      shelf.add(grp);
      tapFig(grp, 360, 'Bil');
    }

    // Row 4 left, beside the globe: tiny picture frame standing up
    {
      const grp = new THREE.Group();
      const frameM = mat(0xcfa370, { roughness: 0.55 });
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.13, 0.10),
        frameM,
      );
      frame.position.y = 0.07;
      frame.castShadow = true;
      grp.add(frame);
      // Picture (a tiny pastel canvas)
      const pic = new THREE.Mesh(
        new THREE.PlaneGeometry(0.075, 0.10),
        new THREE.MeshBasicMaterial({ color: 0xf6dde6 }),
      );
      pic.rotation.y = -Math.PI / 2;
      pic.position.set(-0.014, 0.075, 0);
      grp.add(pic);
      // Tiny stand
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.005, 0.05),
        frameM,
      );
      stand.position.set(-0.005, 0.0025, 0);
      grp.add(stand);
      grp.position.set(figX, 1.555, cubbyLeft + 0.22);
      shelf.add(grp);
      tapFig(grp, 780, 'Foto');
    }

    // Row 4 right, beside the duck: two short books leaning together
    {
      const grp = new THREE.Group();
      const cols = [0x9ac4e9, 0xc28dba];
      for (let i = 0; i < 2; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.13, 0.10),
          mat(cols[i], { roughness: 0.85 }),
        );
        b.position.set(i * 0.045 - 0.022, 0.067, 0);
        b.rotation.z = (i === 0) ? 0.10 : -0.06;
        b.castShadow = true;
        grp.add(b);
      }
      grp.position.set(figX, 1.555, cubbyRight - 0.22);
      shelf.add(grp);
      tapFig(grp, 860, 'Småböcker');
    }
  }

  // ----- Toys on TOP of the pine shelf (y ≈ 1.80) -----
  {
    const topY = sh;  // 1.80

    // Big rainbow stacker on the left side
    {
      const stack = new THREE.Group();
      const cols = [0xe55f7a, 0xf2a93a, 0xf5d547, 0x6cc24a, 0x4a90e2, 0x8e6cd6];
      // Base peg
      const peg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8),
        mat(0xcfa370, { roughness: 0.5 }),
      );
      peg.position.set(0, topY + 0.09, -sw / 2 + 0.20);
      stack.add(peg);
      // Disks of decreasing size
      for (let i = 0; i < cols.length; i++) {
        const r = 0.075 - i * 0.010;
        const disk = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, 0.022, 18),
          mat(cols[i], { roughness: 0.65 }),
        );
        disk.position.set(0, topY + 0.022 + i * 0.024, -sw / 2 + 0.20);
        disk.castShadow = true;
        stack.add(disk);
      }
      shelf.add(stack);
      tapWiggle(stack, 523, 'Regnbågsstapel', { sway: 0.10, lift: 0.04, duration: 520 });
    }

    // Toy kite leaning against the wall (back of shelf), rope drawn
    {
      const kite = new THREE.Group();
      const kiteMat = mat(0x9ac4e9, { roughness: 0.55 });
      const cross = mat(0xfffaf2, { roughness: 0.55 });
      // Diamond made of two triangles
      const diaShape = new THREE.Shape();
      diaShape.moveTo(0, 0.12); diaShape.lineTo(0.08, 0); diaShape.lineTo(0, -0.12); diaShape.lineTo(-0.08, 0); diaShape.lineTo(0, 0.12);
      const dia = new THREE.Mesh(new THREE.ShapeGeometry(diaShape), kiteMat);
      dia.position.set(sd / 2 - 0.05, topY + 0.15, -0.10);
      dia.rotation.y = -Math.PI / 2;
      dia.rotation.x = -0.25;
      kite.add(dia);
      // White cross frame
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.24, 0.005), cross);
      v.position.copy(dia.position);
      v.rotation.copy(dia.rotation);
      kite.add(v);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.005, 0.16), cross);
      h.position.copy(dia.position);
      h.rotation.copy(dia.rotation);
      kite.add(h);
      // Three tassels at the bottom
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(
          new THREE.SphereGeometry(0.012, 8, 6),
          mat([0xe55f7a, 0xf5d547, 0x6cc24a][i], { roughness: 0.8 }),
        );
        t.position.set(sd / 2 - 0.04, topY + 0.05 - i * 0.025, -0.10 - i * 0.005);
        kite.add(t);
      }
      shelf.add(kite);
      tapWiggle(kite, 1568, 'Drake', { sway: 0.4, lift: 0.06, duration: 600 });
    }

    // Cluster of helium balloons on a string
    {
      const ball = new THREE.Group();
      const cols = [0xe55f7a, 0x4a90e2, 0xf5d547];
      const baseZ = sw / 2 - 0.20;
      const baseY = topY + 0.18;
      for (let i = 0; i < cols.length; i++) {
        const balloon = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 14, 12),
          mat(cols[i], { roughness: 0.45 }),
        );
        const a = (i - 1) * 0.6;
        balloon.position.set(Math.cos(a) * 0.03, baseY + 0.05 + i * 0.015, baseZ + Math.sin(a) * 0.06);
        balloon.scale.set(0.95, 1.1, 0.95);
        balloon.castShadow = true;
        ball.add(balloon);
        // Knot
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), mat(cols[i]));
        knot.position.set(balloon.position.x, balloon.position.y - 0.055, balloon.position.z);
        ball.add(knot);
        // String
        const str = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0015, 0.0015, 0.20, 4),
          mat(0xfffaf2),
        );
        str.position.set(balloon.position.x * 0.4, baseY - 0.15, baseZ);
        ball.add(str);
      }
      shelf.add(ball);
      tapWiggle(ball, 988, 'Ballonger', { sway: 0.5, lift: 0.10, duration: 700 });
    }

    // Big plush bear sitting at the right end of the top
    {
      const bear = new THREE.Group();
      const fur = mat(0xc28d6a, { roughness: 1.0 });
      const muz = mat(0xf5e4cf, { roughness: 1.0 });
      const eye = mat(0x2a1f1c);
      const body4 = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 10), fur);
      body4.scale.set(1.0, 0.95, 1.0);
      body4.position.set(0, topY + 0.10, sw / 2 - 0.20);
      body4.castShadow = true;
      bear.add(body4);
      const head2 = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), fur);
      head2.position.set(0, topY + 0.235, sw / 2 - 0.20);
      bear.add(head2);
      for (const ez of [-0.055, 0.055]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), fur);
        ear.position.set(-0.01, topY + 0.288, sw / 2 - 0.20 + ez);
        bear.add(ear);
      }
      const sn = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), muz);
      sn.position.set(-0.06, topY + 0.225, sw / 2 - 0.20);
      bear.add(sn);
      for (const ez of [-0.025, 0.025]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), eye);
        e.position.set(-0.068, topY + 0.252, sw / 2 - 0.20 + ez);
        bear.add(e);
      }
      shelf.add(bear);
      tapWiggle(bear, 165, 'Stor nalle', { sway: 0.25, lift: 0.05, duration: 500 });
    }
  }

  // Frame body for AABB
  const shelfBody = new THREE.Mesh(
    new THREE.BoxGeometry(sd, sh, sw),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  shelfBody.position.y = sh / 2;
  shelf.add(shelfBody);

  placeObject(shelf, {
    name: 'pineShelf',
    x: ROOM.w / 2 - sd / 2 - 0.04,
    // Flush with the front end of the small white table at back-right.
    // Table front face is at z = -ROOM.d/2 + tableLen + 0.02 = -0.98. The
    // shelf's back end panel is a 0.05m-thick slab centered at z - sw/2, so
    // its back face sits at (z - sw/2 - 0.025). Set that equal to -0.98.
    z: -0.98 + sw / 2 + 0.025,
    blocking: shelfBody,
  });
}

// ============================================================
//  Small white side table flush against the right wall (back portion)
// ============================================================
{
  const tDepth = 0.50;
  const tLen = 1.00;
  const tH = 0.75;
  const topThick = 0.04;
  const legThick = 0.05;
  const table = new THREE.Group();
  const whiteMat = mat(0xfdfcf8, { roughness: 0.78 });

  // Top
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(tDepth, topThick, tLen),
    whiteMat,
  );
  top.position.y = tH - topThick / 2;
  top.castShadow = true; top.receiveShadow = true;
  table.add(top);

  // Apron just under the top
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(tDepth - 0.04, 0.06, tLen - 0.04),
    whiteMat,
  );
  apron.position.y = tH - topThick - 0.03;
  table.add(apron);

  // Four legs near the corners
  const legY = (tH - topThick) / 2;
  const lx = tDepth / 2 - 0.04;
  const lz = tLen / 2 - 0.06;
  for (const sx of [-lx, lx]) {
    for (const sz of [-lz, lz]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(legThick, tH - topThick, legThick),
        whiteMat,
      );
      leg.position.set(sx, legY, sz);
      leg.castShadow = true; leg.receiveShadow = true;
      table.add(leg);
    }
  }

  // ----- Crafting items on top of the table -----
  // Top surface sits at y = tH = 0.75; all items sit above that.
  // Local +x = toward right wall (back of table), -x = toward room (front edge).
  // Local +z = front-of-room end of the table, -z = corner end.
  const topY = tH;  // 0.75
  {
    // Stack of colored paper (a few thin sheets in different colors) +
    // a small heart drawing on the top sheet. Grouped so the whole stack
    // lifts as one to reveal letter R underneath.
    const paperGrp = new THREE.Group();
    const paperCols = [0xfff5fa, 0xfdf6c0, 0xc9e6f7, 0xfbd1a2];
    for (let i = 0; i < paperCols.length; i++) {
      const sheet = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.004, 0.24),
        mat(paperCols[i], { roughness: 0.9 }),
      );
      sheet.position.set(-0.04, topY + 0.004 + i * 0.004, -0.32);
      sheet.rotation.y = (i - 1.5) * 0.04;
      sheet.castShadow = true; sheet.receiveShadow = true;
      paperGrp.add(sheet);
    }
    const heart = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 10, 8),
      mat(0xe55f7a, { roughness: 0.9 }),
    );
    heart.scale.set(1.2, 0.3, 1.0);
    heart.position.set(-0.04, topY + 0.022, -0.32);
    paperGrp.add(heart);
    table.add(paperGrp);
    // Hidden letter R under the paper stack
    const letterR = buildLetter('R', 'R');
    letterR.position.set(-0.04, topY + 0.11, -0.32);
    letterR.visible = false;
    table.add(letterR);
    registerHidden(paperGrp, letterR, 'paperLift', { label: 'Pappersbunt' });
  }

  {
    // Crayon holder: a short cup with crayons sticking out
    const crayGrp = new THREE.Group();
    const jarMat = mat(0xb4e3c8, { roughness: 0.6 });
    const jar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.038, 0.08, 16),
      jarMat,
    );
    jar.position.set(0.05, topY + 0.04, -0.30);
    jar.castShadow = true; jar.receiveShadow = true;
    crayGrp.add(jar);
    // Crayons poking out at slight angles
    const crayCols = [0xe55f7a, 0xf2a93a, 0xf5d547, 0x6cc24a, 0x4a90e2, 0x8e6cd6];
    for (let i = 0; i < crayCols.length; i++) {
      const cr = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.10, 8),
        mat(crayCols[i], { roughness: 0.7 }),
      );
      const ang = (i / crayCols.length) * Math.PI * 2;
      const r = 0.022;
      cr.position.set(0.05 + Math.cos(ang) * r, topY + 0.11, -0.30 + Math.sin(ang) * r);
      cr.rotation.z = Math.cos(ang) * 0.18;
      cr.rotation.x = -Math.sin(ang) * 0.18;
      crayGrp.add(cr);
      // Pointed tip (cone)
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.006, 0.014, 8),
        mat(crayCols[i], { roughness: 0.7 }),
      );
      tip.position.copy(cr.position);
      tip.position.y += 0.055;
      tip.rotation.z = cr.rotation.z;
      tip.rotation.x = cr.rotation.x;
      crayGrp.add(tip);
    }
    table.add(crayGrp);
    tapWiggle(crayGrp, 740, 'Kritor', { sway: 0.15, lift: 0.03 });
  }

  {
    // Safety scissors — flat handle loops and short blade
    const sc = new THREE.Group();
    const bladeMat = mat(0xcfd6dc, { metalness: 0.5, roughness: 0.4 });
    const handleMat = mat(0xe55f7a, { roughness: 0.7 });
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.006, 0.018),
      bladeMat,
    );
    blade.position.set(0.04, 0, 0);
    sc.add(blade);
    for (const sz of [-0.020, 0.020]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.018, 0.006, 8, 18),
        handleMat,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(-0.04, 0, sz);
      sc.add(ring);
    }
    sc.position.set(0.10, topY + 0.008, 0.05);
    sc.rotation.y = 0.45;
    table.add(sc);
    tapWiggle(sc, 1320, 'Sax', { sway: 0.25, lift: 0.04 });
  }

  {
    // Glue stick — a small white-and-purple capped tube
    const glueGrp = new THREE.Group();
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.08, 14),
      mat(0xfdfcf8, { roughness: 0.7 }),
    );
    tube.position.set(-0.12, topY + 0.04, 0.10);
    tube.rotation.z = Math.PI / 2;
    tube.rotation.y = 0.15;
    tube.castShadow = true;
    glueGrp.add(tube);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.024, 14),
      mat(0x8e6cd6, { roughness: 0.7 }),
    );
    cap.position.set(-0.072, topY + 0.04, 0.108);
    cap.rotation.z = Math.PI / 2;
    cap.rotation.y = 0.15;
    glueGrp.add(cap);
    table.add(glueGrp);
    tapWiggle(glueGrp, 392, 'Limstift', { sway: 0.18, lift: 0.04 });
  }

  {
    // Sticker sheet — flat rectangle with little colored dots
    const stickerGrp = new THREE.Group();
    const sheet = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.003, 0.20),
      mat(0xfffaf0, { roughness: 0.9 }),
    );
    sheet.position.set(0.10, topY + 0.0015, 0.32);
    sheet.rotation.y = -0.20;
    stickerGrp.add(sheet);
    const dotCols = [0xe55f7a, 0xf5d547, 0x6cc24a, 0x4a90e2, 0xf2a93a, 0x8e6cd6];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.012, 14),
          mat(dotCols[(r * 4 + c) % dotCols.length], { roughness: 0.85 }),
        );
        dot.rotation.x = -Math.PI / 2;
        const lx = -0.045 + c * 0.030;
        const lz = -0.070 + r * 0.060;
        const cosA = Math.cos(-0.20), sinA = Math.sin(-0.20);
        dot.position.set(
          0.10 + lx * cosA + lz * sinA,
          topY + 0.0035,
          0.32 - lx * sinA + lz * cosA,
        );
        stickerGrp.add(dot);
      }
    }
    table.add(stickerGrp);
    tapWiggle(stickerGrp, 990, 'Stickers', { sway: 0.10, lift: 0.025 });
  }

  {
    // A finished little craft: tiny paper airplane near the room-facing edge
    const planeMat = mat(0xc9e6f7, { roughness: 0.9 });
    const planeGrp = new THREE.Group();
    const wing = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.10, 4),
      planeMat,
    );
    wing.scale.set(1.0, 1.0, 0.18);
    wing.rotation.z = -Math.PI / 2;
    planeGrp.add(wing);
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.04, 4),
      planeMat,
    );
    tail.rotation.z = -Math.PI / 2;
    tail.position.set(-0.04, 0.012, 0);
    planeGrp.add(tail);
    planeGrp.position.set(-0.18, topY + 0.02, -0.10);
    planeGrp.rotation.y = 0.55;
    table.add(planeGrp);
    tapWiggle(planeGrp, 1175, 'Pappersflygplan', { sway: 0.55, lift: 0.10, duration: 520 });
  }

  // Frame body for AABB
  const tableBody = new THREE.Mesh(
    new THREE.BoxGeometry(tDepth, tH, tLen),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  tableBody.position.y = tH / 2;
  table.add(tableBody);

  placeObject(table, {
    name: 'whiteTable',
    x: ROOM.w / 2 - tDepth / 2 - 0.02,    // flush against right wall
    z: -ROOM.d / 2 + tLen / 2 + 0.02,     // flush against back wall (BACK-RIGHT corner)
    blocking: tableBody,
  });
}

// ============================================================
//  Goose painting — right wall, front-side of bookshelf. Tap = honk.
//  Replaces the goose character. Canvas texture has a hand-drawn goose
//  silhouette on a sky-blue background.
// ============================================================
{
  const paintW = 0.55;      // along z (wall direction)
  const paintH = 0.70;      // along y
  const frameThick = 0.04;  // along x (depth into room)
  const wallX = ROOM.w / 2 - frameThick / 2 - 0.005;
  const paintY = 1.45;
  const paintZ = 1.10;      // front-of-bookshelf side (bookshelf front-end panel at z=0.545)

  const painting = new THREE.Group();
  painting.name = 'goosePainting';

  // Frame: a slightly larger wood-tone box behind the canvas
  const frameMat = mat(0x8a5a3b, { roughness: 0.55 });
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, paintH + 0.08, paintW + 0.08),
    frameMat,
  );
  frame.castShadow = true; frame.receiveShadow = true;
  painting.add(frame);

  // Canvas face — drawn with a canvas texture (silhouette of a goose)
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = 384; c.height = 512;
    const ctx = c.getContext('2d');
    // Sky-blue background
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#bfe0f5');
    grad.addColorStop(1, '#e8f4fb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 384, 512);
    // Ground stripe
    ctx.fillStyle = '#9ec48a';
    ctx.fillRect(0, 430, 384, 82);
    // Goose body (white blob)
    ctx.fillStyle = '#fdfdfb';
    ctx.beginPath();
    ctx.ellipse(192, 320, 110, 80, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tail
    ctx.beginPath();
    ctx.moveTo(86, 305);
    ctx.lineTo(48, 280);
    ctx.lineTo(92, 330);
    ctx.closePath();
    ctx.fill();
    // Neck
    ctx.beginPath();
    ctx.moveTo(255, 290);
    ctx.bezierCurveTo(290, 230, 285, 170, 250, 130);
    ctx.bezierCurveTo(240, 125, 230, 135, 235, 165);
    ctx.bezierCurveTo(240, 200, 235, 250, 230, 295);
    ctx.closePath();
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.ellipse(248, 130, 32, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Beak (orange)
    ctx.fillStyle = '#f4a23a';
    ctx.beginPath();
    ctx.moveTo(275, 130);
    ctx.lineTo(310, 128);
    ctx.lineTo(275, 145);
    ctx.closePath();
    ctx.fill();
    // Eye
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(258, 124, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Legs (orange)
    ctx.fillStyle = '#f4a23a';
    ctx.fillRect(178, 390, 7, 40);
    ctx.fillRect(206, 390, 7, 40);
    // Caption
    ctx.fillStyle = '#3a3a55';
    ctx.font = 'bold 32px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Tryck mig!', 192, 478);

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(paintW, paintH),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  // Plane normal defaults to +z; we want it to face -x (into the room).
  face.rotation.y = -Math.PI / 2;
  face.position.x = -frameThick / 2 - 0.001;
  painting.add(face);

  placeObject(painting, {
    name: 'goosePainting',
    x: wallX,
    y: paintY,
    z: paintZ,
    interact: () => { SFX.honk(); },
    noFade: true,
  });
}

// ============================================================
//  Floor toys hugging the walls (keeps room middle tidy)
// ============================================================

// Rocking horse — back wall, left of center
{
  const horse = new THREE.Group();
  const woodTone = mat(0xc8956d, { roughness: 0.75 });
  const maneMat = mat(0xe3a8b8, { roughness: 0.7 });
  const saddleMat = mat(0xb05a6e, { roughness: 0.6 });

  // Body (oval-ish)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), woodTone);
  body.scale.set(1.3, 0.85, 0.7);
  body.position.y = 0.34;
  horse.add(body);

  // Head and neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.18, 12), woodTone);
  neck.position.set(0.18, 0.46, 0);
  neck.rotation.z = -0.5;
  horse.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), woodTone);
  head.scale.set(1.2, 0.9, 0.85);
  head.position.set(0.26, 0.55, 0);
  horse.add(head);

  // Eye
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat(0x2a1a14));
  eye.position.set(0.31, 0.57, 0.05);
  horse.add(eye);

  // Mane
  for (let i = 0; i < 5; i++) {
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), maneMat);
    tuft.position.set(0.16 - i * 0.04, 0.55 - i * 0.01, 0);
    horse.add(tuft);
  }

  // Tail
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), maneMat);
  tail.scale.set(1.4, 1.4, 0.9);
  tail.position.set(-0.22, 0.34, 0);
  horse.add(tail);

  // Saddle
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.18), saddleMat);
  saddle.position.set(0.02, 0.46, 0);
  horse.add(saddle);

  // Rockers (curved planks under)
  for (const zOff of [-0.13, 0.13]) {
    const rocker = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 8, 18, Math.PI), woodTone);
    rocker.rotation.x = Math.PI / 2;
    rocker.rotation.y = Math.PI;
    rocker.position.set(0, 0.06, zOff);
    horse.add(rocker);
  }

  // Legs
  for (const [lx, lz] of [[0.10, 0.11], [0.10, -0.11], [-0.10, 0.11], [-0.10, -0.11]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.020, 0.22, 10), woodTone);
    leg.position.set(lx, 0.17, lz);
    horse.add(leg);
  }

  // Rocking animation override
  registerInteract(horse, () => {
    tone(330, 0.10, 'triangle');
    tone(440, 0.10, 'triangle', 0.08);
    tone(330, 0.10, 'triangle', 0.16);
    if (horse.userData._rocking) return;
    horse.userData._rocking = true;
    const start = performance.now();
    const baseRot = horse.rotation.x;
    (function step() {
      const t = (performance.now() - start) / 1200;
      if (t >= 1) { horse.rotation.x = baseRot; horse.userData._rocking = false; return; }
      const decay = 1 - t;
      horse.rotation.x = baseRot + Math.sin(t * Math.PI * 5) * 0.25 * decay;
      requestAnimationFrame(step);
    })();
  }, { label: 'Gunghäst' });

  placeObject(horse, { name: 'rockingHorse', x: -0.75, z: -ROOM.d / 2 + 0.30, yaw: -0.6 });
}

// Basket of plush toys — back wall, right of center
{
  const basket = new THREE.Group();
  const wickerMat = mat(0xc9a274, { roughness: 0.85 });

  // Basket body (woven cylinder)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.20, 16, 1, true), wickerMat);
  body.position.y = 0.10;
  basket.add(body);
  // Bottom
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 16), wickerMat);
  bottom.position.y = 0.005;
  basket.add(bottom);
  // Rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 8, 24), wickerMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.20;
  basket.add(rim);
  // Horizontal weave bands
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.175 - i * 0.005, 0.006, 6, 20), mat(0xa07c4a, { roughness: 0.85 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.05 + i * 0.06;
    basket.add(band);
  }

  // Plush peeking out — pink bunny
  const bunny = new THREE.Group();
  const bunnyMat = mat(0xf5c8d2, { roughness: 0.85 });
  const bunnyHead = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), bunnyMat);
  bunny.add(bunnyHead);
  const ear1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.10, 6, 8), bunnyMat);
  ear1.position.set(-0.025, 0.08, 0);
  ear1.rotation.z = 0.2;
  bunny.add(ear1);
  const ear2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.10, 6, 8), bunnyMat);
  ear2.position.set(0.025, 0.08, 0);
  ear2.rotation.z = -0.2;
  bunny.add(ear2);
  for (const [ex, ez] of [[-0.025, 0.06], [0.025, 0.06]]) {
    const eyeB = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat(0x2a1a14));
    eyeB.position.set(ex, 0.005, ez);
    bunny.add(eyeB);
  }
  bunny.position.set(-0.05, 0.26, 0.04);
  bunny.rotation.z = -0.15;
  basket.add(bunny);

  // Plush peeking — yellow duck
  const duck = new THREE.Group();
  const duckMat = mat(0xf4d97a, { roughness: 0.85 });
  const duckHead = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), duckMat);
  duck.add(duckHead);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.04, 8), mat(0xe89a4c));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.005, 0.05);
  duck.add(beak);
  for (const [ex, ez] of [[-0.018, 0.04], [0.018, 0.04]]) {
    const eyeD = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), mat(0x2a1a14));
    eyeD.position.set(ex, 0.018, ez);
    duck.add(eyeD);
  }
  duck.position.set(0.06, 0.25, -0.02);
  duck.rotation.z = 0.18;
  basket.add(duck);

  // Plush peeking — small star
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), mat(0xf4b860, { roughness: 0.75, emissive: 0xa86a18, emissiveIntensity: 0.15 }));
  star.position.set(0.02, 0.28, 0.10);
  basket.add(star);

  tapWiggle(basket, 660, 'Korg med gosedjur', { sway: 0.10, lift: 0.04, duration: 460 });
  placeObject(basket, { name: 'plushBasket', x: 0.75, z: -ROOM.d / 2 + 0.28 });
}

// Doll stroller — back wall, center-right
{
  const stroller = new THREE.Group();
  const frameMat = mat(0xe89aa8, { roughness: 0.55, metalness: 0.2 });
  const fabricMat = mat(0xfde2eb, { roughness: 0.8 });
  const wheelMat = mat(0x2a2a36, { roughness: 0.7 });

  // Bucket (the cradle)
  const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), fabricMat);
  bucket.position.y = 0.32;
  stroller.add(bucket);
  // Bucket trim
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.02, 0.335), frameMat);
  trim.position.y = 0.40;
  stroller.add(trim);

  // Canopy (half-dome)
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), fabricMat);
  canopy.scale.set(1.0, 0.7, 1.0);
  canopy.position.set(0, 0.41, -0.06);
  stroller.add(canopy);

  // Handle bar
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.013, 8, 16, Math.PI), frameMat);
  handle.rotation.x = Math.PI / 2;
  handle.rotation.z = Math.PI;
  handle.position.set(0, 0.50, 0.20);
  stroller.add(handle);
  const handlePost1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8), frameMat);
  handlePost1.position.set(-0.07, 0.41, 0.17);
  stroller.add(handlePost1);
  const handlePost2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8), frameMat);
  handlePost2.position.set(0.07, 0.41, 0.17);
  stroller.add(handlePost2);

  // Frame legs
  for (const [lx, lz] of [[-0.10, -0.14], [0.10, -0.14], [-0.10, 0.14], [0.10, 0.14]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.28, 8), frameMat);
    leg.position.set(lx, 0.14, lz);
    stroller.add(leg);
  }

  // Wheels
  for (const [wx, wz] of [[-0.10, -0.14], [0.10, -0.14], [-0.10, 0.14], [0.10, 0.14]]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.018, 8, 14), wheelMat);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(wx, 0.045, wz);
    stroller.add(wheel);
  }

  // Tiny doll head peeking out
  const dollHead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), mat(0xf3d3b5, { roughness: 0.7 }));
  dollHead.position.set(0, 0.42, 0.10);
  stroller.add(dollHead);
  const dollHair = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8a5a3a, { roughness: 0.85 }));
  dollHair.position.set(0, 0.435, 0.10);
  stroller.add(dollHair);

  tapWiggle(stroller, 523, 'Dockvagn', { sway: 0.12, lift: 0.05, duration: 480 });
  placeObject(stroller, { name: 'dollStroller', x: 0.08, z: -ROOM.d / 2 + 0.28, yaw: 0.3 });
}

// Hula hoop leaning against left wall (in the gap between bunk and dresser)
{
  const hoopGrp = new THREE.Group();
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 10, 32), mat(0xe07ab8, { roughness: 0.45, emissive: 0x6a2854, emissiveIntensity: 0.15 }));
  hoop.position.y = 0.22;
  hoopGrp.add(hoop);
  // Striped color rings
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.TorusGeometry(0.221, 0.020, 6, 8, Math.PI / 4), mat([0xf3d96b, 0x7ad1a5, 0x6ec0ff, 0xffffff][i], { roughness: 0.55 }));
    seg.rotation.z = (i * Math.PI) / 2;
    seg.position.y = 0.22;
    hoopGrp.add(seg);
  }
  hoopGrp.rotation.z = 0.25;  // lean against wall
  tapWiggle(hoopGrp, 880, 'Tunnband', { sway: 0.25, lift: 0.02, duration: 500 });
  placeObject(hoopGrp, { name: 'hulaHoop', x: -ROOM.w / 2 + 0.10, z: -0.55 });
}

// ============================================================
//  Big "1 2 3 / 4 5 6 / 7 8 9 0" wall poster on right wall above shelf
//  ARCHIVED — flip to `if (true)` to restore.
// ============================================================
if (false) {
  const posterW = 1.0, posterH = 1.0;
  const px = ROOM.w / 2 - 0.025;
  const py = 1.95;
  const pz = -0.5;

  // Frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, posterH + 0.06, posterW + 0.06),
    mat(0xfffaf2, { roughness: 0.7 }),
  );
  frame.position.set(px, py, pz);
  scene.add(frame);

  // Poster face (a canvas texture w/ numbers)
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fffaf2';
  ctx.fillRect(0, 0, 512, 512);
  ctx.font = 'bold 110px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [' ', '0', ' '],
  ];
  const cols = [120, 256, 392];
  const ys = [80, 200, 320, 440];
  const colors = ['#e08aa6', '#e3a366', '#7fb591', '#7aa8d4', '#d28cd0', '#d97b8a', '#e0a564', '#9ac4a8', '#a8c6e6'];
  let idx = 0;
  for (let r = 0; r < 4; r++) {
    for (let cn = 0; cn < 3; cn++) {
      const ch = rows[r][cn];
      if (ch.trim() === '') continue;
      ctx.fillStyle = colors[idx % colors.length];
      ctx.fillText(ch, cols[cn], ys[r]);
      idx++;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(posterW, posterH),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  poster.position.set(px - 0.011, py, pz);
  poster.rotation.y = -Math.PI / 2;
  scene.add(poster);
}

// ============================================================
//  Hidden-item registration: container -> revealed item
// ============================================================
function registerHidden(container, hiddenItem, animKind, opts = {}) {
  const initial = {
    pos: container.position.clone(),
    rot: container.rotation.clone(),
    scale: container.scale.clone(),
  };
  let opened = false;
  container.userData.kind = 'container';
  container.userData.label = opts.label;

  function animate(targetFn, durMs, then) {
    const start = performance.now();
    const startPos = container.position.clone();
    const startRot = container.rotation.clone();
    const startScale = container.scale.clone();
    (function step() {
      const t = Math.min(1, (performance.now() - start) / durMs);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const tgt = targetFn();
      container.position.lerpVectors(startPos, tgt.pos, e);
      container.rotation.x = startRot.x + (tgt.rot.x - startRot.x) * e;
      container.rotation.y = startRot.y + (tgt.rot.y - startRot.y) * e;
      container.rotation.z = startRot.z + (tgt.rot.z - startRot.z) * e;
      container.scale.lerpVectors(startScale, tgt.scale, e);
      if (t < 1) requestAnimationFrame(step);
      else then?.();
    })();
  }

  function targetForOpen() {
    const tgt = {
      pos: initial.pos.clone(),
      rot: initial.rot.clone(),
      scale: initial.scale.clone(),
    };
    switch (animKind) {
      case 'lift':
        tgt.pos.y += 0.45;
        tgt.pos.z += 0.1;
        tgt.rot.x = initial.rot.x - 0.4;
        break;
      case 'hop':
        tgt.pos.y += 0.35;
        tgt.pos.x += 0.25;
        tgt.rot.z = initial.rot.z - 0.5;
        break;
      case 'paperLift':
        tgt.pos.y += 0.3;
        tgt.rot.z = initial.rot.z - 0.6;
        break;
      case 'door':
        // Pivot group hinges at the door's left edge — pure rotation.
        tgt.rot.y = initial.rot.y - 1.7;
        break;
      case 'flipLid':
        tgt.rot.x = initial.rot.x - 1.2;
        tgt.pos.y += 0.04;
        break;
      case 'wiggle':
        tgt.pos.x += 0.32;
        tgt.rot.z = initial.rot.z - 0.4;
        break;
      default:
        tgt.pos.y += 0.3;
    }
    return tgt;
  }

  registerInteract(container, () => {
    if (opened) return;
    opened = true;
    container.userData.opened = true;
    SFX.open();
    toast(`Du hittade något under ${opts.label || 'det'}!`);
    animate(targetForOpen, 500, () => {
      hiddenItem.visible = true;
      // Float-in animation for the revealed item
      hiddenItem.scale.set(0.001, 0.001, 0.001);
      const startT = performance.now();
      (function pop() {
        const t = Math.min(1, (performance.now() - startT) / 350);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const s = e * 1.0;
        hiddenItem.scale.set(s, s, s);
        if (t < 1) requestAnimationFrame(pop);
      })();
    });
  }, { label: opts.label });

  // Mark the hidden item as itself interactable (tap to collect)
  registerInteract(hiddenItem, () => collectItem(hiddenItem));
}

function registerCandle(c) {
  registerInteract(c, () => collectItem(c), { label: 'Ljus' });
}

// ============================================================
//  Collect logic
// ============================================================
function collectItem(item) {
  if (item.userData.collected) return;
  item.userData.collected = true;
  // Pop & rise animation
  const start = performance.now();
  const startPos = item.position.clone();
  const startScale = item.scale.clone();
  (function step() {
    const t = Math.min(1, (performance.now() - start) / 600);
    item.position.y = startPos.y + t * 0.6;
    const s = (1 - t) * Math.max(0.8, startScale.x);
    item.scale.set(s, s, s);
    item.rotation.y += 0.15;
    if (t < 1) requestAnimationFrame(step);
    else {
      item.visible = false;
      if (item.parent) item.parent.remove(item);
    }
  })();

  if (item.userData.kind === 'letter') {
    const key = item.userData.letterKey;
    const slot = game.letters.find(l => l.key === key);
    if (slot && !slot.found) {
      slot.found = true;
      const el = document.querySelector(`.letter[data-letter="${key}"]`);
      if (el) el.classList.add('found');
      toast(`Bokstav ${slot.label}!`);
      SFX.letter();
    }
  } else if (item.userData.kind === 'candle') {
    game.candlesFound = Math.min(game.candleTotal, game.candlesFound + 1);
    document.getElementById('candle-count').textContent = `${game.candlesFound} / ${game.candleTotal}`;
    toast(`Ljus! (${game.candlesFound} av ${game.candleTotal})`);
    SFX.candle();
  }
  checkWin();
}

function checkWin() {
  const allLetters = game.letters.every(l => l.found);
  const allCandles = game.candlesFound >= game.candleTotal;
  if (allLetters && allCandles) {
    setTimeout(showWin, 600);
  }
}

// ============================================================
//  Toast
// ============================================================
let toastTimer = null;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  // Force reflow to restart animation
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 250);
  }, 1500);
}

// ============================================================
//  Debug labels — toggleable orientation markers
//  Initial visibility controlled by DEBUG_LABELS_DEFAULT; runtime
//  toggle via the "D" button in index.html or the 'd' keypress.
// ============================================================
const DEBUG_LABELS_DEFAULT = false;
let debugLabelsGroup = null;
{
  function makeLabelSprite(text, fg = '#111', bg = 'rgba(255,255,255,0.92)') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const ctx2 = c.getContext('2d');
    ctx2.fillStyle = bg;
    ctx2.strokeStyle = fg;
    ctx2.lineWidth = 4;
    const r = 14;
    ctx2.beginPath();
    ctx2.moveTo(r, 2);
    ctx2.lineTo(c.width - r, 2);
    ctx2.quadraticCurveTo(c.width - 2, 2, c.width - 2, r);
    ctx2.lineTo(c.width - 2, c.height - r);
    ctx2.quadraticCurveTo(c.width - 2, c.height - 2, c.width - r, c.height - 2);
    ctx2.lineTo(r, c.height - 2);
    ctx2.quadraticCurveTo(2, c.height - 2, 2, c.height - r);
    ctx2.lineTo(2, r);
    ctx2.quadraticCurveTo(2, 2, r, 2);
    ctx2.closePath();
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = fg;
    ctx2.font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(sMat);
    sprite.scale.set(0.7, 0.26, 1);
    sprite.renderOrder = 9999;
    sprite.userData.debugLabel = true;
    sprite.raycast = () => {}; // exclude from x-ray fade raycaster
    return sprite;
  }
  const debugGroup = new THREE.Group();
  debugGroup.userData.debugLabels = true;
  debugGroup.visible = DEBUG_LABELS_DEFAULT;
  debugLabelsGroup = debugGroup;
  scene.add(debugGroup);
  const labelData = [
    // Wall midpoints (high, easy to spot in default view)
    { t: 'FRONT (+Z)', x: 0, y: 2.35, z: ROOM.d / 2 - 0.02, fg: '#b03030' },
    { t: 'BACK (-Z)',  x: 0, y: 2.35, z: -ROOM.d / 2 + 0.02, fg: '#b03030' },
    { t: 'LEFT (-X)',  x: -ROOM.w / 2 + 0.02, y: 2.35, z: 0, fg: '#2050b0' },
    { t: 'RIGHT (+X)', x:  ROOM.w / 2 - 0.02, y: 2.35, z: 0, fg: '#2050b0' },
    // Floor corners — letters A..D so we have a short shared vocabulary
    { t: 'A: BACK-LEFT',   x: -ROOM.w / 2 + 0.25, y: 0.15, z: -ROOM.d / 2 + 0.25, fg: '#000' },
    { t: 'B: BACK-RIGHT',  x:  ROOM.w / 2 - 0.25, y: 0.15, z: -ROOM.d / 2 + 0.25, fg: '#000' },
    { t: 'C: FRONT-LEFT',  x: -ROOM.w / 2 + 0.25, y: 0.15, z:  ROOM.d / 2 - 0.25, fg: '#000' },
    { t: 'D: FRONT-RIGHT', x:  ROOM.w / 2 - 0.25, y: 0.15, z:  ROOM.d / 2 - 0.25, fg: '#000' },
    // Key features
    { t: 'DOOR',   x: 1.30, y: 2.20, z:  ROOM.d / 2 - 0.05, fg: '#c06000' },
    { t: 'WINDOW', x: 0,    y: 2.20, z: -ROOM.d / 2 + 0.05, fg: '#0a8095' },
  ];
  for (const d of labelData) {
    const s = makeLabelSprite(d.t, d.fg);
    s.position.set(d.x, d.y, d.z);
    debugGroup.add(s);
  }
  // Small floor dots at each corner so the corners are unambiguous in top-down
  for (const [cx, cz, color] of [
    [-ROOM.w / 2 + 0.05, -ROOM.d / 2 + 0.05, 0xff3030],
    [ ROOM.w / 2 - 0.05, -ROOM.d / 2 + 0.05, 0x30c030],
    [-ROOM.w / 2 + 0.05,  ROOM.d / 2 - 0.05, 0x3070ff],
    [ ROOM.w / 2 - 0.05,  ROOM.d / 2 - 0.05, 0xffaa00],
  ]) {
    const dot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.005, 24),
      new THREE.MeshBasicMaterial({ color }),
    );
    dot.position.set(cx, 0.003, cz);
    dot.renderOrder = 9998;
    dot.raycast = () => {};
    debugGroup.add(dot);
  }
  // Axes helper at room origin (red=X, green=Y, blue=Z)
  const axes = new THREE.AxesHelper(0.6);
  axes.position.set(0, 0.01, 0);
  axes.renderOrder = 9998;
  if (axes.material) axes.material.depthTest = false;
  axes.raycast = () => {};
  debugGroup.add(axes);
}

// ============================================================
//  Camera control — UGG-style top-down 3/4 pan
//  Camera looks at `target`. User pans target around the room.
//  Yaw rotates camera around the target; pitch is fixed-ish (UGG tilt).
// ============================================================
// The camera ANCHOR is parked at a fixed corner of the room (orbited around the
// room's center via yaw/pitch/distance). cam.target lerps toward the goose so
// only the *look direction* changes as the goose moves — the camera position
// itself stays put.
const ROOM_CENTER = new THREE.Vector3(0, 0.5, 0);
const cam = {
  target: new THREE.Vector3(0, 0.5, 0),
  yaw: Math.PI * 0.22,    // anchor angle: front-right corner of the room
  pitch: Math.PI * 0.28,  // anchor elevation
  minPitch: Math.PI * 0.18,
  maxPitch: Math.PI * 0.42,
  distance: 7.8,          // anchor distance from room center
  minDistance: 4.5,
  maxDistance: 11.0,
};

function updateCameraAnchor() {
  // Recompute the camera's WORLD POSITION from yaw/pitch/distance around the room center.
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    ROOM_CENTER.x + cam.distance * cp * Math.sin(cam.yaw),
    ROOM_CENTER.y + cam.distance * Math.sin(cam.pitch),
    ROOM_CENTER.z + cam.distance * cp * Math.cos(cam.yaw),
  );
}

function updateCameraFromCam() {
  updateCameraAnchor();
  camera.lookAt(cam.target);
}

// Effective view-yaw based on the camera's actual look direction (not the
// anchor angle). Used to convert joystick input → world direction.
function getViewYaw() {
  const lx = cam.target.x - camera.position.x;
  const lz = cam.target.z - camera.position.z;
  // Match the existing convention: forward = (-sin(yaw), -cos(yaw)) in XZ.
  return Math.atan2(-lx, -lz);
}

// Clamp target so user can't pan camera off into space.
const PAN_LIMIT = {
  xMin: -ROOM.w / 2 + 0.4, xMax: ROOM.w / 2 - 0.4,
  zMin: -ROOM.d / 2 + 0.4, zMax: ROOM.d / 2 - 0.4,
};
function clampTarget() {
  cam.target.x = Math.max(PAN_LIMIT.xMin, Math.min(PAN_LIMIT.xMax, cam.target.x));
  cam.target.z = Math.max(PAN_LIMIT.zMin, Math.min(PAN_LIMIT.zMax, cam.target.z));
}

// Convert screen-aligned input (right/forward) into world-space (X, Z) direction
// using current camera VIEW yaw (derived from camera→target). Screen-up = away
// from camera = toward room.
function screenToWorld(screenDX, screenDY) {
  const v = getViewYaw();
  const cy = Math.cos(v), sy = Math.sin(v);
  return {
    x: screenDX * cy - screenDY * sy,
    z: -screenDX * sy - screenDY * cy,
  };
}

// ============================================================
//  Nearest-interactable marker — floating yellow orb above the closest item
// ============================================================
const NEAR_RADIUS = 0.95;
// Goose stands ~0.5m tall; with a stretched neck it can reach roughly chest/desk
// height. Items above this world-Y are out of reach (e.g. top of the bookshelf).
const REACH_MAX_Y = 1.35;
let nearestItem = null;

const nearMarker = new THREE.Group();
const nearOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 14, 10),
  new THREE.MeshStandardMaterial({
    color: 0xffe066,
    emissive: 0xffc23a,
    emissiveIntensity: 0.9,
    roughness: 0.4,
  }),
);
nearMarker.add(nearOrb);
// Soft halo
const nearHalo = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 14, 10),
  new THREE.MeshBasicMaterial({
    color: 0xffe066, transparent: true, opacity: 0.25,
  }),
);
nearMarker.add(nearHalo);
nearMarker.visible = false;
scene.add(nearMarker);
markNoFade(nearMarker);

const _worldPos = new THREE.Vector3();
function updateNearestInteractable() {
  let best = null;
  let bestD2 = NEAR_RADIUS * NEAR_RADIUS;
  for (const o of game.interactables) {
    if (!o.visible || o.userData.collected || o.userData.opened) continue;
    o.getWorldPosition(_worldPos);
    if (_worldPos.y > REACH_MAX_Y) continue;
    const dx = _worldPos.x - goose.x;
    const dz = _worldPos.z - goose.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = o; }
  }
  if (best !== nearestItem) {
    nearestItem = best;
    const btn = document.getElementById('beak-btn');
    if (btn) btn.classList.toggle('armed', !!nearestItem);
  }
  if (best) {
    best.getWorldPosition(_worldPos);
    const bob = Math.sin(performance.now() / 280) * 0.04;
    nearMarker.position.set(
      _worldPos.x,
      Math.max(_worldPos.y + 0.35, 0.55) + bob,
      _worldPos.z,
    );
    nearMarker.visible = true;
  } else {
    nearMarker.visible = false;
  }
}

function triggerBeak() {
  // Always honk — empty honks are fun. If something is nearby, also peck it.
  // Snap the timer to a fresh open-close cycle so rapid spacebar presses
  // produce a visible "chomp chomp" rhythm in sync with the audio clips.
  goose.honkTimer = 0.22;
  SFX.honk();
  if (nearestItem && nearestItem.userData.onTap && nearestItem.visible && !nearestItem.userData.collected) {
    goose.peckTimer = 0.32;
    // Delay the actual interaction slightly so the peck animation reads.
    setTimeout(() => {
      if (nearestItem && nearestItem.userData.onTap && nearestItem.visible && !nearestItem.userData.collected) {
        nearestItem.userData.onTap();
      }
    }, 140);
    return true;
  }
  return false;
}

// ============================================================
//  Goose collision — walls + major furniture AABBs (XZ only).
// ============================================================
const goosePadding = goose.radius;
const wallMin = -ROOM.w / 2 + goosePadding;
const wallMaxX = ROOM.w / 2 - goosePadding;
const wallMinZ = -ROOM.d / 2 + goosePadding;
const wallMaxZ = ROOM.d / 2 - goosePadding;

// Hand-authored AABBs for archived furniture have been removed alongside
// the visuals. New objects should pass `blocking: true` to placeObject()
// so the hitbox follows the visual automatically.

function resolveCollision(nx, nz) {
  // Clamp to walls
  nx = Math.max(wallMin, Math.min(wallMaxX, nx));
  nz = Math.max(wallMinZ, Math.min(wallMaxZ, nz));
  // Push out of each furniture AABB on the shorter axis
  for (const [, x0, z0, x1, z1] of blockingAABBs) {
    const ex0 = x0 - goosePadding, ex1 = x1 + goosePadding;
    const ez0 = z0 - goosePadding, ez1 = z1 + goosePadding;
    if (nx > ex0 && nx < ex1 && nz > ez0 && nz < ez1) {
      const dxL = nx - ex0, dxR = ex1 - nx;
      const dzL = nz - ez0, dzR = ez1 - nz;
      const minX = Math.min(dxL, dxR);
      const minZ = Math.min(dzL, dzR);
      if (minX < minZ) {
        nx = (dxL < dxR) ? ex0 - 0.0001 : ex1 + 0.0001;
      } else {
        nz = (dzL < dzR) ? ez0 - 0.0001 : ez1 + 0.0001;
      }
    }
  }
  return { x: nx, z: nz };
}

// ============================================================
//  Tap-to-walk navigation — grid A* over the same wall+AABB
//  obstacles `resolveCollision` already uses. 10cm cells, 8-connected,
//  octile heuristic, line-of-sight smoothing for straight diagonals.
// ============================================================
const NAV = {
  cell: 0.10,
  pad: goose.radius + 0.04,  // inflate obstacles by agent radius + slack
  minX: wallMin, maxX: wallMaxX,
  minZ: wallMinZ, maxZ: wallMaxZ,
  cols: 0, rows: 0,
  walk: null,                // Uint8Array (1 = walkable)
};

class MinHeap {
  constructor() { this.a = []; }
  push(item) {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; if (a.length === 0) return null;
    const top = a[0], last = a.pop();
    if (a.length === 0) return top;
    a[0] = last;
    let i = 0; const n = a.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1; let s = i;
      if (l < n && a[l].f < a[s].f) s = l;
      if (r < n && a[r].f < a[s].f) s = r;
      if (s === i) break;
      [a[s], a[i]] = [a[i], a[s]]; i = s;
    }
    return top;
  }
  get size() { return this.a.length; }
}

function navBuild() {
  NAV.cols = Math.ceil((NAV.maxX - NAV.minX) / NAV.cell);
  NAV.rows = Math.ceil((NAV.maxZ - NAV.minZ) / NAV.cell);
  NAV.walk = new Uint8Array(NAV.cols * NAV.rows);
  // Inflate each AABB by NAV.pad and mark its cells unwalkable
  for (let r = 0; r < NAV.rows; r++) {
    for (let c = 0; c < NAV.cols; c++) {
      const wx = NAV.minX + (c + 0.5) * NAV.cell;
      const wz = NAV.minZ + (r + 0.5) * NAV.cell;
      let blocked = false;
      for (const [, x0, z0, x1, z1] of blockingAABBs) {
        if (wx > x0 - NAV.pad && wx < x1 + NAV.pad &&
            wz > z0 - NAV.pad && wz < z1 + NAV.pad) { blocked = true; break; }
      }
      NAV.walk[r * NAV.cols + c] = blocked ? 0 : 1;
    }
  }
}

function navCellAt(wx, wz) {
  return [
    Math.max(0, Math.min(NAV.cols - 1, Math.floor((wx - NAV.minX) / NAV.cell))),
    Math.max(0, Math.min(NAV.rows - 1, Math.floor((wz - NAV.minZ) / NAV.cell))),
  ];
}
function navWorldOfCell(c, r) {
  return [NAV.minX + (c + 0.5) * NAV.cell, NAV.minZ + (r + 0.5) * NAV.cell];
}
function navIsWalkable(c, r) {
  if (c < 0 || c >= NAV.cols || r < 0 || r >= NAV.rows) return false;
  return NAV.walk[r * NAV.cols + c] === 1;
}
// Find nearest walkable cell via BFS (used when tap lands on an obstacle).
function navSnapToWalkable(c, r) {
  if (navIsWalkable(c, r)) return [c, r];
  const seen = new Set([c + ',' + r]);
  const q = [[c, r]];
  let head = 0;
  while (head < q.length) {
    const [cc, rr] = q[head++];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = rr + dr;
        const key = nc + ',' + nr;
        if (seen.has(key)) continue;
        if (nc < 0 || nc >= NAV.cols || nr < 0 || nr >= NAV.rows) continue;
        if (navIsWalkable(nc, nr)) return [nc, nr];
        seen.add(key);
        q.push([nc, nr]);
        if (q.length > 4000) return [c, r];  // give up — shouldn't happen
      }
    }
  }
  return [c, r];
}

function navFindPath(sx, sz, tx, tz) {
  const [s0, s1] = navSnapToWalkable(...navCellAt(sx, sz));
  const [g0, g1] = navSnapToWalkable(...navCellAt(tx, tz));
  if (s0 === g0 && s1 === g1) return [[tx, tz]];

  const cost = new Map();              // key "c,r" → best g
  const parent = new Map();
  const startKey = s0 + ',' + s1;
  cost.set(startKey, 0);
  const open = new MinHeap();
  const SQRT2 = Math.SQRT2;
  const h = (c, r) => {
    const dx = Math.abs(c - g0), dz = Math.abs(r - g1);
    return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);  // octile
  };
  open.push({ c: s0, r: s1, f: h(s0, s1) });

  let foundKey = null;
  let iter = 0;
  const MAX_ITER = NAV.cols * NAV.rows;
  while (open.size && iter++ < MAX_ITER) {
    const cur = open.pop();
    const curKey = cur.c + ',' + cur.r;
    if (cur.c === g0 && cur.r === g1) { foundKey = curKey; break; }
    const gCur = cost.get(curKey);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cur.c + dc, nr = cur.r + dr;
        if (!navIsWalkable(nc, nr)) continue;
        // No corner-cutting: diagonal requires both orthogonals to be free.
        if (dc !== 0 && dr !== 0) {
          if (!navIsWalkable(cur.c + dc, cur.r) || !navIsWalkable(cur.c, cur.r + dr)) continue;
        }
        const step = (dc !== 0 && dr !== 0) ? SQRT2 : 1;
        const gN = gCur + step;
        const nKey = nc + ',' + nr;
        if (gN < (cost.get(nKey) ?? Infinity)) {
          cost.set(nKey, gN);
          parent.set(nKey, curKey);
          open.push({ c: nc, r: nr, f: gN + h(nc, nr) });
        }
      }
    }
  }
  if (!foundKey) return null;

  // Reconstruct cell path
  const cells = [];
  let k = foundKey;
  while (k) {
    const [c, r] = k.split(',').map(Number);
    cells.push([c, r]);
    k = parent.get(k);
  }
  cells.reverse();
  // To world coords; replace final cell center with the actual target point.
  const pts = cells.map(([c, r]) => navWorldOfCell(c, r));
  pts[pts.length - 1] = [tx, tz];
  return navSmooth(pts);
}

// Line-of-sight check: walk a segment in small steps; reject if any sample
// hits an inflated obstacle (or wall bound).
function navClearSegment(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / (NAV.cell * 0.5)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, z = az + dz * t;
    if (x < NAV.minX || x > NAV.maxX || z < NAV.minZ || z > NAV.maxZ) return false;
    for (const [, x0, z0, x1, z1] of blockingAABBs) {
      if (x > x0 - NAV.pad && x < x1 + NAV.pad &&
          z > z0 - NAV.pad && z < z1 + NAV.pad) return false;
    }
  }
  return true;
}
function navSmooth(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    if (!navClearSegment(pts[anchor][0], pts[anchor][1], pts[i][0], pts[i][1])) {
      out.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// Approach point: pick a walkable spot far enough from the item that the
// goose ends up beside it, not clipping into it. The stop distance is the
// item's own XZ half-extent + goose radius + a small gap. Try 12 angular
// offsets and rank by distance to the goose (closer feels snappier).
const _navApproachBox = new THREE.Box3();
function navApproachPoint(ix, iz, fromX, fromZ, targetObj) {
  let halfExtent = 0;
  if (targetObj) {
    targetObj.updateMatrixWorld(true);
    _navApproachBox.setFromObject(targetObj);
    const sx = _navApproachBox.max.x - _navApproachBox.min.x;
    const sz = _navApproachBox.max.z - _navApproachBox.min.z;
    halfExtent = Math.max(sx, sz) * 0.5;
  }
  const reach = halfExtent + goose.radius + 0.32;
  const offsets = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    offsets.push([ix + Math.cos(a) * reach, iz + Math.sin(a) * reach]);
  }
  offsets.sort((a, b) => {
    const da = (a[0] - fromX) ** 2 + (a[1] - fromZ) ** 2;
    const db = (b[0] - fromX) ** 2 + (b[1] - fromZ) ** 2;
    return da - db;
  });
  for (const [ox, oz] of offsets) {
    const [c, r] = navCellAt(ox, oz);
    if (navIsWalkable(c, r)) return [ox, oz];
  }
  // Fallback: nearest walkable cell to the item itself.
  const [sc, sr] = navSnapToWalkable(...navCellAt(ix, iz));
  return navWorldOfCell(sc, sr);
}

navBuild();

// Floor tap-target marker (fades out after each tap).
const tapMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.18, 0.30, 32),
  new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0, side: THREE.DoubleSide }),
);
tapMarker.rotation.x = -Math.PI / 2;
tapMarker.position.y = 0.012;
tapMarker.renderOrder = 2;
tapMarker.visible = false;       // goose removed — no floor walk markers
scene.add(tapMarker);
markNoFade(tapMarker);
const tapMarkerState = { t: 0, life: 0.9 };
function showTapMarker(x, z) {
  tapMarker.position.x = x;
  tapMarker.position.z = z;
  tapMarkerState.t = tapMarkerState.life;
  tapMarker.material.opacity = 0.85;
}

// ============================================================
//  Tap highlight — bumps emissive on tapped interactable subtree
//  so the player feels their tap registered.
// ============================================================
// Keyed by material (not mesh) — multiple meshes can share one material, and
// re-capturing emissive after the first mutation corrupts the "original" state.
const highlights = new Map(); // material -> { origColor: Color, origIntensity, t }
const HL_DURATION = 0.8;
const HL_COLOR = new THREE.Color(0xffe066);
const _hlTmpColor = new THREE.Color();
function highlightObject(root) {
  const seen = new Set();
  root.traverse(m => {
    if (!m.isMesh || !m.material) return;
    const mat = m.material;
    if (seen.has(mat)) return;
    seen.add(mat);
    if (!mat.emissive || mat.emissiveIntensity === undefined) return;
    let rec = highlights.get(mat);
    if (!rec) {
      rec = {
        origColor: mat.emissive.clone(),
        origIntensity: mat.emissiveIntensity,
        t: HL_DURATION,
      };
      highlights.set(mat, rec);
    } else {
      rec.t = HL_DURATION;
    }
    mat.emissive.copy(HL_COLOR);
    mat.emissiveIntensity = Math.max(0.9, rec.origIntensity + 0.9);
  });
}
function highlightUpdate(dt) {
  for (const [mat, rec] of highlights) {
    rec.t -= dt;
    if (rec.t <= 0) {
      mat.emissive.copy(rec.origColor);
      mat.emissiveIntensity = rec.origIntensity;
      highlights.delete(mat);
      continue;
    }
    const f = rec.t / HL_DURATION; // 1 → 0
    const targetIntensity = rec.origIntensity + 0.9 * f * (0.7 + 0.3 * Math.sin(f * Math.PI * 4));
    mat.emissiveIntensity = targetIntensity;
    _hlTmpColor.copy(rec.origColor).lerp(HL_COLOR, f);
    mat.emissive.copy(_hlTmpColor);
  }
}

// ============================================================
//  Reaction bubbles — speech bubble with emojis + drifting honks
// ============================================================
// One distinctive emoji per object — different things feel like different things.
const EMOJI_REACTIONS = {
  'Filt': '😴',
  'Igelkott': '🦔',
  'Låda': '📦',
  'Skåpsdörr': '🚪',
  'Pikachu': '⚡',
  'Papper': '📄',
  'Bricka': '🍪',
  'Tvätt': '🦨',
  'Ljus': '🕯️',
  'Bokstav E': '🎉',
  'Bokstav L': '💖',
  'Bokstav I': '✨',
  'Bokstav N': '🌟',
  'Bokstav O': '🍩',
  'Bokstav R': '🌈',
};

function pickEmoji(label) {
  return EMOJI_REACTIONS[label] || '🤔';
}

const overlayLayer = document.getElementById('overlay-layer');
const bubbles = []; // { el, wp: Vector3, expires, fadeStart }
const _projTmp = new THREE.Vector3();

function projectToScreen(wp) {
  _projTmp.copy(wp).project(camera);
  const x = (_projTmp.x + 1) * 0.5 * window.innerWidth;
  const y = (1 - (_projTmp.y + 1) * 0.5) * window.innerHeight;
  return { x, y, behind: _projTmp.z > 1 };
}

// Goose head world position — used as the anchor for thought bubbles + honks.
const _gooseHeadWp = new THREE.Vector3();
function gooseHeadWp() {
  _gooseHeadWp.set(goose.x, 1.35, goose.z);
  return _gooseHeadWp;
}

function spawnHonk(emoji) {
  if (!overlayLayer) return;
  const el = document.createElement('div');
  el.className = 'honk-bubble';
  el.textContent = emoji;
  const dx = (Math.random() - 0.5) * 40;
  const dxEnd = dx + (Math.random() - 0.5) * 60;
  const rot = ((Math.random() - 0.5) * 14).toFixed(1) + 'deg';
  el.style.setProperty('--dx', dx + 'px');
  el.style.setProperty('--dxEnd', dxEnd + 'px');
  el.style.setProperty('--rot', rot);
  overlayLayer.appendChild(el);
  // Snapshot the goose's head position at spawn time so the honk floats off
  // from where she honked, even if she keeps walking.
  const wp = gooseHeadWp().clone();
  bubbles.push({
    el,
    wp,
    expires: performance.now() + 1300,
    isHonk: true,
  });
}

function spawnReaction(_obj, label) {
  spawnHonk(pickEmoji(label));
  SFX.honk();
  goose.honkTimer = 0.22;
}

function bubblesUpdate() {
  const now = performance.now();
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (now >= b.expires) {
      b.el.remove();
      bubbles.splice(i, 1);
      continue;
    }
    if (!b.placed) {
      // Project once at spawn time and let CSS animate the float-up.
      const p = projectToScreen(b.wp);
      b.el.style.left = p.x + 'px';
      b.el.style.top = p.y + 'px';
      b.placed = true;
    }
  }
}

updateCameraFromCam();

// Dev/test handles
window.__cam = cam;
window.__orbit = cam;  // back-compat for any test harness referencing __orbit
window.__goose = goose;
window.__triggerBeak = triggerBeak;
window.__game = game;
window.__camera = camera;
window.__scene = scene;
window.__renderer = renderer;
window.__audio = audio;
window.SFX = SFX;
window.__nav = {
  NAV, navBuild, navCellAt, navWorldOfCell, navIsWalkable,
  navSnapToWalkable, navFindPath, navApproachPoint,
};

// On-screen joystick removed; tap-to-walk + WASD drive the goose now.
// `joy` is kept as an inert stub so the existing input loop can still read
// `joy.active`/`joy.dx`/`joy.dy` without a forest of null checks.
const joy = { active: false, pointerId: null, dx: 0, dy: 0 };
function joyEnd() {}
function joyStart() {}
function joyMove() {}
function hitJoystick() { return false; }

// Pinch state (mobile zoom + pan). lastCentroid tracks the midpoint of the two
// fingers between pointermove ticks so we can translate the orbit rig along
// the floor as the centroid drifts.
const pinch = {
  active: false,
  startDist: 0,
  startDistance: 0,
  lastCentroid: null,
  pointers: new Map(),
};

// Mouse-drag pan state (desktop)
const drag = {
  active: false,
  pointerId: null,
  lastX: 0, lastY: 0,
  moved: 0,
};

// Pointer events (work for both touch and mouse on iPad/desktop)
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinch.pointers.size === 2) {
    const [a, b] = [...pinch.pointers.values()];
    pinch.active = true;
    pinch.startDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinch.startDistance = cam.distance;
    pinch.lastCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    joyEnd();
    drag.active = false;
    // A pinch is never a tap — drop any pending candidate so releasing the
    // first finger after a pinch doesn't accidentally fire onTap.
    canvas._tapStart = null;
    return;
  }

  if (hitJoystick(e.clientX, e.clientY)) {
    joy.pointerId = e.pointerId;
    joyStart(e.clientX, e.clientY);
  } else {
    // Both: candidate for tap AND for click-drag-pan (whichever wins by motion threshold).
    canvas._tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    drag.active = true;
    drag.pointerId = e.pointerId;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.moved = 0;
  }
}, { passive: true });

canvas.addEventListener('pointermove', e => {
  if (pinch.pointers.has(e.pointerId)) {
    pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  if (pinch.active && pinch.pointers.size >= 2) {
    const [a, b] = [...pinch.pointers.values()];
    // Zoom: scale relative to initial spread.
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ratio = pinch.startDist / Math.max(1, d);
    cam.distance = Math.min(cam.maxDistance, Math.max(cam.minDistance, pinch.startDistance * ratio));
    // Pan: world-space delta = -screenToWorld(centroid delta in pixels * px-to-world).
    // px-to-world keeps the room "stuck" under the fingers regardless of zoom.
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    if (pinch.lastCentroid) {
      const dxs = cx - pinch.lastCentroid.x;
      const dys = cy - pinch.lastCentroid.y;
      const fovRad = camera.fov * Math.PI / 180;
      const pxToWorld = (2 * cam.distance * Math.tan(fovRad / 2)) / Math.max(1, canvas.clientHeight);
      const w = screenToWorld(dxs * pxToWorld, dys * pxToWorld);
      ROOM_CENTER.x = Math.max(PAN_LIMIT.xMin, Math.min(PAN_LIMIT.xMax, ROOM_CENTER.x - w.x));
      ROOM_CENTER.z = Math.max(PAN_LIMIT.zMin, Math.min(PAN_LIMIT.zMax, ROOM_CENTER.z - w.z));
      cam.target.x = Math.max(PAN_LIMIT.xMin, Math.min(PAN_LIMIT.xMax, cam.target.x - w.x));
      cam.target.z = Math.max(PAN_LIMIT.zMin, Math.min(PAN_LIMIT.zMax, cam.target.z - w.z));
    }
    pinch.lastCentroid = { x: cx, y: cy };
    return;
  }
  if (e.pointerId === joy.pointerId) {
    joyMove(e.clientX, e.clientY);
    return;
  }
  if (drag.active && e.pointerId === drag.pointerId) {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.moved += Math.hypot(dx, dy);
    // Mouse drag now rotates the camera yaw (the goose, not the camera, is panned by movement).
    cam.yaw += dx * 0.005;
    cam.pitch = Math.max(cam.minPitch, Math.min(cam.maxPitch, cam.pitch + dy * 0.003));
    if (drag.moved > 8 && canvas._tapStart) canvas._tapStart = null;
  }
}, { passive: true });

function endPointer(e) {
  pinch.pointers.delete(e.pointerId);
  if (pinch.active && pinch.pointers.size < 2) {
    pinch.active = false;
    pinch.lastCentroid = null;
  }
  if (e.pointerId === joy.pointerId) joyEnd();
  if (drag.active && e.pointerId === drag.pointerId) {
    drag.active = false;
    drag.pointerId = null;
  }
  if (canvas._tapStart && e.pointerId === canvas._tapStart.id) {
    const dt = performance.now() - canvas._tapStart.t;
    if (dt < 350) handleTap(canvas._tapStart.x, canvas._tapStart.y);
    canvas._tapStart = null;
  }
}
canvas.addEventListener('pointerup', endPointer, { passive: true });
canvas.addEventListener('pointercancel', endPointer, { passive: true });

// Right-click and wheel default behaviour disabled on canvas (prevent page interference).
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Wheel handler: mouse wheel zooms, Mac trackpad two-finger swipe pans, Mac
// trackpad pinch (browser fires wheel with ctrlKey=true) zooms.
// Heuristic: ctrlKey → zoom; horizontal deltaX or small |deltaY| → trackpad
// pan; otherwise → mouse-wheel zoom. Mouse wheels send |deltaY| ≥ ~100 per
// click in pure vertical, while trackpads send many small continuous deltas.
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey) {
    // Mac pinch (or Ctrl+scroll on desktop) → zoom.
    cam.distance = Math.min(cam.maxDistance, Math.max(cam.minDistance, cam.distance + e.deltaY * 0.012));
    return;
  }
  const isTrackpadSwipe = e.deltaX !== 0 || Math.abs(e.deltaY) < 50;
  if (isTrackpadSwipe) {
    const fovRad = camera.fov * Math.PI / 180;
    const pxToWorld = (2 * cam.distance * Math.tan(fovRad / 2)) / Math.max(1, canvas.clientHeight);
    const w = screenToWorld(e.deltaX * pxToWorld, e.deltaY * pxToWorld);
    ROOM_CENTER.x = Math.max(PAN_LIMIT.xMin, Math.min(PAN_LIMIT.xMax, ROOM_CENTER.x + w.x));
    ROOM_CENTER.z = Math.max(PAN_LIMIT.zMin, Math.min(PAN_LIMIT.zMax, ROOM_CENTER.z + w.z));
    cam.target.x = Math.max(PAN_LIMIT.xMin, Math.min(PAN_LIMIT.xMax, cam.target.x + w.x));
    cam.target.z = Math.max(PAN_LIMIT.zMin, Math.min(PAN_LIMIT.zMax, cam.target.z + w.z));
    return;
  }
  cam.distance = Math.min(cam.maxDistance, Math.max(cam.minDistance, cam.distance + e.deltaY * 0.006));
}, { passive: false });

// ============================================================
//  Keyboard parity — WASD / arrows = move, Q/E = rotate yaw, +/- = zoom, Space = beak
// ============================================================
const keys = Object.create(null);
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  // Goose removed — only camera keys (Q/E yaw, +/- zoom) remain wired up below.
  keys[k] = true;
}, { passive: false });
window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
});

// Beak button removed — tapping an interactable now walks the goose to it and
// triggers the peck automatically on arrival. Spacebar still pecks for desktop.

// ============================================================
//  Raycast tap
// ============================================================
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _floorHit = new THREE.Vector3();

function isVisibleInTree(o) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

function startWalkTo(tx, tz, pending) {
  const path = navFindPath(goose.x, goose.z, tx, tz);
  if (!path || path.length === 0) {
    goose.path = null;
    goose.pathIdx = 0;
    goose.pendingTap = null;
    return false;
  }
  goose.path = path;
  goose.pathIdx = 0;
  goose.pendingTap = pending || null;
  return true;
}

function cancelPath() {
  goose.path = null;
  goose.pathIdx = 0;
  goose.pendingTap = null;
  goose.turnTo = null;
}

// Things we never treat as a tap target — even if the ray hits them, the goose
// shouldn't react. Anything else is fair game.
function isTapBlocker(node) {
  return node === room || node === goose.obj || node === tapMarker
      || node === nearMarker || node === interactRoot;
}

// Queue a "turn toward the object, then react" sequence — used both when the
// goose was already standing next to the tap target and after a walk arrival.
function triggerReaction(o, hasOnTap, outOfReach) {
  const wp = new THREE.Vector3();
  o.getWorldPosition(wp);
  goose.turnTo = {
    tx: wp.x, tz: wp.z,
    t: 0.45,
    done: () => {
      if (!o || o.userData.collected || !isVisibleInTree(o)) return;
      spawnReaction(o, o.userData.label);
      if (outOfReach) {
        toast('Den är för högt upp!');
      } else if (hasOnTap && o.userData.onTap) {
        o.userData.onTap();
      }
    },
  };
}

function performTap(o, hasOnTap) {
  o.getWorldPosition(_worldPos);
  highlightObject(o);
  // Head-aim: track the tapped object so the player sees the goose recognize it.
  goose.lookAt = { tx: _worldPos.x, ty: _worldPos.y, tz: _worldPos.z, t: 6.0 };
  if (_worldPos.y > REACH_MAX_Y) {
    const [ax, az] = navApproachPoint(_worldPos.x, _worldPos.z, goose.x, goose.z, o);
    startWalkTo(ax, az, { obj: o, outOfReach: true, hasOnTap });
    return;
  }
  const [ax, az] = navApproachPoint(_worldPos.x, _worldPos.z, goose.x, goose.z, o);
  if (Math.hypot(goose.x - ax, goose.z - az) < 0.18) {
    cancelPath();
    triggerReaction(o, hasOnTap, false);
    return;
  }
  startWalkTo(ax, az, { obj: o, hasOnTap });
}

function handleTap(x, y) {
  // Convert page coords to NDC against the canvas (not the window — UI overlays
  // shift the canvas on some layouts).
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((x - rect.left) / rect.width) * 2 - 1,
    -((y - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);

  // Goose removed — tapping a registered interactable now fires its onTap
  // directly. No walking, no path, no turnTo. Highlight the tapped subtree
  // so the player sees their tap landed, then dispatch.
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const hit of hits) {
    const o = hit.object;
    if (!isVisibleInTree(o)) continue;
    let registered = null;
    for (let n = o; n; n = n.parent) {
      if (isTapBlocker(n)) break;
      if (n.userData && n.userData.interactable && n.userData.onTap && !n.userData.collected) {
        registered = n;
        break;
      }
    }
    if (registered) {
      highlightObject(registered);
      registered.userData.onTap();
      return;
    }
  }
}
window.__handleTap = handleTap;
window.__performTap = performTap;
window.__highlights = highlights;

// ============================================================
//  X-ray fade — meshes between camera and goose fade to semi-transparent so
//  the goose stays visible behind furniture (bunk bed, shelves, etc.).
// ============================================================
const FADE_OPACITY = 0.22;
const FADE_LERP = 9;           // per-second blend rate
const _fadeRay = new THREE.Raycaster();
const _fadeDir = new THREE.Vector3();
const _fadeOrigin = new THREE.Vector3();
const fading = new Map();      // mesh → { origOpacity, origTransparent, origDepthWrite }

function ancestorBlocksFade(mesh) {
  for (let n = mesh; n; n = n.parent) {
    if (n.userData && n.userData.noFade) return true;
  }
  return false;
}

const _fadePerp = new THREE.Vector3();
function fadeUpdate(dt) {
  _fadeOrigin.copy(camera.position);
  const nowFading = new Set();
  // Sample the goose's silhouette with a small grid of rays. A single ray
  // threads between objects that visually overlap the goose; widening the
  // sample catches them.
  // Compute a horizontal perpendicular to the camera→goose direction so the
  // side offsets cover the goose's apparent width on screen.
  _fadeDir.set(goose.x - _fadeOrigin.x, 0, goose.z - _fadeOrigin.z);
  _fadePerp.set(-_fadeDir.z, 0, _fadeDir.x).normalize();
  const HALF_W = 0.22; // half the goose's body width
  for (const targetY of [0.05, 0.45, 0.85]) {
    for (const sideOff of [-HALF_W, 0, HALF_W]) {
      const tx = goose.x + _fadePerp.x * sideOff;
      const tz = goose.z + _fadePerp.z * sideOff;
      _fadeDir.set(tx - _fadeOrigin.x, targetY - _fadeOrigin.y, tz - _fadeOrigin.z);
      const dist = _fadeDir.length();
      if (dist < 0.2) continue;
      _fadeDir.divideScalar(dist);
      _fadeRay.set(_fadeOrigin, _fadeDir);
      _fadeRay.near = 0;
      _fadeRay.far = Math.max(0.1, dist - 0.30);
      const hits = _fadeRay.intersectObjects(scene.children, true);
      for (const hit of hits) {
        const m = hit.object;
        if (!m || !m.isMesh || !m.material || !m.visible) continue;
        if (ancestorBlocksFade(m)) continue;
        nowFading.add(m);
      }
    }
  }

  // Fade incoming meshes down to FADE_OPACITY.
  const k = Math.min(1, dt * FADE_LERP);
  for (const m of nowFading) {
    let rec = fading.get(m);
    if (!rec) {
      // First fade: clone the material so we don't pollute shared materials.
      // Save the original reference so we can swap it back when fade fully
      // restores — otherwise a clone created mid-highlight inherits the
      // highlighted emissive and stays lit forever (highlightUpdate keeps
      // ticking the original, not the clone).
      const orig = m.material;
      rec = {
        origMaterial: orig,
        origOpacity: orig.opacity,
        origTransparent: orig.transparent,
        origDepthWrite: orig.depthWrite,
      };
      const clone = orig.clone();
      // If this material is currently being highlighted, reset the clone's
      // emissive to the saved baseline so the fading object doesn't glow.
      const hl = highlights.get(orig);
      if (hl && clone.emissive) {
        clone.emissive.copy(hl.origColor);
        clone.emissiveIntensity = hl.origIntensity;
      }
      clone.transparent = true;
      clone.depthWrite = false;
      m.material = clone;
      fading.set(m, rec);
    }
    m.material.opacity += (FADE_OPACITY - m.material.opacity) * k;
  }
  // Restore meshes no longer in the ray.
  for (const [m, rec] of fading) {
    if (nowFading.has(m)) continue;
    m.material.opacity += (rec.origOpacity - m.material.opacity) * k;
    if (Math.abs(m.material.opacity - rec.origOpacity) < 0.01) {
      // Swap back to the original material so the highlight system (which
      // still references it) can drive the mesh's emissive again.
      m.material = rec.origMaterial;
      fading.delete(m);
    }
  }
}

// ============================================================
//  Overlap-check — flags any two placed objects whose 3D bounds intersect.
//  Uses the blocking XZ rect (extended to full height) when the object has
//  blocking set, otherwise the full visual bounds. Re-run from devtools with
//  `checkOverlaps()` after live tweaks.
// ============================================================
function checkOverlaps() {
  scene.updateMatrixWorld(true);
  const skip = new Set(['floor', 'wallLeft', 'wallRight', 'wallBack', 'rug']);
  const items = roomObjects
    .filter(o => o.name && !skip.has(o.name))
    .map(o => {
      if (o.aabb) {
        const [, minX, minZ, maxX, maxZ] = o.aabb;
        return {
          name: o.name,
          box: new THREE.Box3(
            new THREE.Vector3(minX, 0, minZ),
            new THREE.Vector3(maxX, ROOM.h, maxZ),
          ),
        };
      }
      return { name: o.name, box: new THREE.Box3().setFromObject(o.group) };
    });

  const overlaps = [];
  const EPS = 0.005;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].box, b = items[j].box;
      const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
      const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
      if (dx > EPS && dy > EPS && dz > EPS) {
        overlaps.push({ a: items[i].name, b: items[j].name, dx, dy, dz });
      }
    }
  }
  if (overlaps.length === 0) {
    console.log('[overlap-check] OK — no overlaps among', items.length, 'objects');
  } else {
    console.warn(`[overlap-check] ${overlaps.length} overlap(s):`);
    overlaps.forEach(o => console.warn(
      `  ${o.a} ⇆ ${o.b}: ${o.dx.toFixed(3)} × ${o.dy.toFixed(3)} × ${o.dz.toFixed(3)} m`,
    ));
  }
  return overlaps;
}
window.checkOverlaps = checkOverlaps;
checkOverlaps();

// ============================================================
//  Animation loop
// ============================================================
const clock = new THREE.Clock();
function animate() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  // Goose removed — no movement input. Direction stays zero; the goose model is
  // hidden anyway, so the rest of the animate loop is a no-op for the player.
  let inX = 0, inY = 0;

  // Translate screen input → world direction using camera VIEW yaw (derived
  // from camera→target so input direction stays correct as the camera rotates
  // to track the goose).
  const viewYaw = getViewYaw();
  const fy = Math.cos(viewYaw), fx = Math.sin(viewYaw);
  let dirX = inX * fy + inY * (-fx);
  let dirZ = inX * (-fx) + inY * (-fy);

  // Manual input cancels any active tap-walk path.
  const manualMag = Math.hypot(dirX, dirZ);
  if (manualMag > 0.05 && goose.path) cancelPath();

  // Tap-to-walk path follow — drives dirX/dirZ when no manual input is active.
  if (goose.path && manualMag <= 0.05) {
    let wp = goose.path[goose.pathIdx];
    let wdx = wp[0] - goose.x, wdz = wp[1] - goose.z;
    let wd = Math.hypot(wdx, wdz);
    // Advance through waypoints we've already reached.
    while (wd < 0.10 && goose.pathIdx < goose.path.length - 1) {
      goose.pathIdx++;
      wp = goose.path[goose.pathIdx];
      wdx = wp[0] - goose.x; wdz = wp[1] - goose.z;
      wd = Math.hypot(wdx, wdz);
    }
    if (goose.pathIdx >= goose.path.length - 1 && wd < 0.06) {
      // Arrived at final waypoint.
      const pending = goose.pendingTap;
      cancelPath();
      if (pending && pending.obj && !pending.obj.userData.collected && isVisibleInTree(pending.obj)) {
        triggerReaction(pending.obj, pending.hasOnTap, pending.outOfReach);
      }
    } else if (wd > 1e-4) {
      dirX = wdx / wd;
      dirZ = wdz / wd;
    }
  }

  const speed = goose.speed;
  let nx = goose.x + dirX * speed * dt;
  let nz = goose.z + dirZ * speed * dt;
  ({ x: nx, z: nz } = resolveCollision(nx, nz));
  const moved = Math.hypot(nx - goose.x, nz - goose.z);
  goose.x = nx;
  goose.z = nz;
  goose.moving = moved > 0.0008;
  if (goose.moving && (Math.abs(dirX) + Math.abs(dirZ)) > 0.05) {
    // Rotate goose to face movement direction (smoothly)
    const targetFace = Math.atan2(dirX, dirZ);
    let delta = targetFace - goose.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    goose.facing += delta * Math.min(1, dt * 10);
    goose.walkPhase += dt * 9;
  }

  if (!goose.moving && goose.turnTo) {
    const tt = goose.turnTo;
    const targetAngle = Math.atan2(tt.tx - goose.x, tt.tz - goose.z);
    let delta = targetAngle - goose.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    goose.facing += delta * Math.min(1, dt * 8);
    tt.t -= dt;
    if (tt.t <= 0 || Math.abs(delta) < 0.05) {
      const done = tt.done;
      goose.turnTo = null;
      if (done) done();
    }
  }

  // Apply transform to goose mesh
  goose.obj.position.set(goose.x, 0, goose.z);
  goose.obj.rotation.y = goose.facing;

  const parts = goose.obj.userData.parts;
  const base = goose.obj.userData.base;

  // ----- Honk / peck timers -----
  if (goose.honkTimer > 0) goose.honkTimer = Math.max(0, goose.honkTimer - dt);
  if (goose.peckTimer > 0) goose.peckTimer = Math.max(0, goose.peckTimer - dt);
  // Beak opens fast then closes over the honk duration — sin half-arc gives
  // a smooth open-close cycle. Rapid presses snap the timer back up so each
  // press re-opens the bill instantly for a chomp-chomp rhythm.
  const HONK_DUR = 0.22;
  const honkFrac = goose.honkTimer > 0
    ? Math.sin(Math.PI * (1 - goose.honkTimer / HONK_DUR))
    : 0;
  // Peck rides on its own curve: 0 → 1 → 0 over the duration
  let peckFrac = 0;
  if (goose.peckTimer > 0) {
    const p = 1 - goose.peckTimer / 0.32;
    peckFrac = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  }

  // ----- Walking -----
  if (goose.moving) {
    const s = Math.sin(goose.walkPhase);
    const c = Math.cos(goose.walkPhase);
    // Feet swing forward/back
    parts.leftFoot.position.z = s * 0.09;
    parts.rightFoot.position.z = -s * 0.09;
    // Slight foot lift when forward
    parts.leftFoot.position.y = 0.014 + Math.max(0, s) * 0.03;
    parts.rightFoot.position.y = 0.014 + Math.max(0, -s) * 0.03;
    // Body waddle — side-to-side roll
    goose.obj.rotation.z = c * 0.05;
    // Body bob up/down (twice per step)
    parts.body.position.y = base.bodyY + Math.abs(s) * 0.02;
    // Subtle head bob — counter to body
    if (!honkFrac && !peckFrac) parts.neck.rotation.x = -0.04 + Math.sin(goose.walkPhase * 2) * 0.06;
    // Tail wags side-to-side a touch
    parts.tail.rotation.y = c * 0.15;
  } else {
    parts.leftFoot.position.z *= 0.85;
    parts.rightFoot.position.z *= 0.85;
    parts.leftFoot.position.y += (0.014 - parts.leftFoot.position.y) * 0.2;
    parts.rightFoot.position.y += (0.014 - parts.rightFoot.position.y) * 0.2;
    goose.obj.rotation.z *= 0.85;
    // Idle breathing
    const breath = Math.sin(t * 1.8 + goose.idlePhase) * 0.006;
    parts.body.position.y = base.bodyY + breath;
    if (!honkFrac && !peckFrac) parts.neck.rotation.x += (0 - parts.neck.rotation.x) * 0.12;
    parts.tail.rotation.y *= 0.85;
  }

  // ----- Honking: open bill only (no neck stretch) so rapid presses read
  //       as a chomp-chomp rhythm rather than a slow head-bob. A light wing
  //       flutter still ships for character.
  if (honkFrac > 0) {
    parts.billLower.rotation.x = 0.65 * honkFrac;
    parts.leftWing.rotation.z = base.leftWingRotZ - 0.18 * honkFrac;
    parts.rightWing.rotation.z = base.rightWingRotZ + 0.18 * honkFrac;
  } else {
    parts.billLower.rotation.x += (0 - parts.billLower.rotation.x) * 0.40;
    parts.leftWing.rotation.z += (base.leftWingRotZ - parts.leftWing.rotation.z) * 0.25;
    parts.rightWing.rotation.z += (base.rightWingRotZ - parts.rightWing.rotation.z) * 0.25;
  }
  // Neck always relaxes to neutral — no more upward stretch on honk.
  parts.neck.position.y += (base.neckPosY - parts.neck.position.y) * 0.20;

  // ----- Pecking: head dips forward+down toward target -----
  if (peckFrac > 0) {
    parts.neck.rotation.x = 0.9 * peckFrac;
    parts.head.position.y = base.headY - 0.10 * peckFrac;
    parts.head.position.z = base.headZ + 0.08 * peckFrac;
  } else {
    parts.head.position.y += (base.headY - parts.head.position.y) * 0.25;
    parts.head.position.z += (base.headZ - parts.head.position.z) * 0.25;
  }

  // ----- Blink (idle) -----
  goose.blinkTimer -= dt;
  if (goose.blinkTimer <= 0 && goose.blinkPhase <= 0) {
    goose.blinkPhase = 0.18; // blink duration in seconds
    goose.blinkTimer = 2.5 + Math.random() * 3.5;
  }
  if (goose.blinkPhase > 0) {
    goose.blinkPhase = Math.max(0, goose.blinkPhase - dt);
    // 0 (start) → closed mid → 1 (end open). Use triangle.
    const f = goose.blinkPhase / 0.18;
    const closed = 1 - Math.abs(f - 0.5) * 2; // 0..1..0
    const sy = 1 - closed * 0.95;
    parts.leftEye.scale.y = sy;
    parts.rightEye.scale.y = sy;
  } else {
    parts.leftEye.scale.y = 1;
    parts.rightEye.scale.y = 1;
  }

  // ---------------- Camera: look at goose, sit on the diagonal opposite ----------------
  // Only chase the goose while she's actively moving AND the user isn't
  // dragging the view. When the goose stands still — or the user pans the
  // camera — the target sits where it is, so the camera doesn't keep
  // creeping after the user lets go.
  if (goose.moving && !drag.active) {
    const followLerp = 1 - Math.pow(0.001, dt);
    cam.target.x += (goose.x - cam.target.x) * followLerp;
    cam.target.z += (goose.z - cam.target.z) * followLerp;
  }
  cam.target.y = 0.5;
  clampTarget();

  // The camera anchor's yaw is pulled toward the *opposite* side of the room
  // from the goose. As the goose approaches a wall, the camera slides around
  // to the diagonally-opposite corner so the goose stays visible from a good
  // viewing angle. Near room center the pull is weak so the view doesn't spin
  // around for tiny movements.
  // Only kick in once the goose enters this margin from any wall. Outside the
  // margin the camera is left completely still — constant rotation would feel
  // like seasickness and makes touch controls awkward.
  const WALL_MARGIN = 1.7;
  const wallDist = Math.min(
    ROOM.w / 2 - goose.x,
    goose.x + ROOM.w / 2,
    ROOM.d / 2 - goose.z,
    goose.z + ROOM.d / 2,
  );
  if (goose.moving && wallDist < WALL_MARGIN && !keys['q'] && !keys['e'] && !drag.active) {
    const gxRel = goose.x - ROOM_CENTER.x;
    const gzRel = goose.z - ROOM_CENTER.z;
    const targetYaw = Math.atan2(-gxRel, -gzRel);
    // Shortest-arc difference
    let dy = targetYaw - cam.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    // Pull strength ramps up the closer the goose gets to a wall.
    const pullStrength = 1 - wallDist / WALL_MARGIN;
    const yawLerp = 1 - Math.exp(-1.8 * pullStrength * dt);
    cam.yaw += dy * yawLerp;
    if (cam.yaw > Math.PI) cam.yaw -= 2 * Math.PI;
    else if (cam.yaw < -Math.PI) cam.yaw += 2 * Math.PI;
  }

  // Manual yaw / zoom (keyboard) — Q/E temporarily overrides the auto-rotate
  const keyYawSpeed = 1.6 * dt;
  const keyZoomSpeed = 4.0 * dt;
  if (keys['q']) cam.yaw -= keyYawSpeed;
  if (keys['e']) cam.yaw += keyYawSpeed;
  if (keys['='] || keys['+']) cam.distance = Math.max(cam.minDistance, cam.distance - keyZoomSpeed);
  if (keys['-'] || keys['_']) cam.distance = Math.min(cam.maxDistance, cam.distance + keyZoomSpeed);

  // WASD / arrows pan the camera in world XZ — same as pinch / two-finger pan
  {
    let kx = 0, kz = 0;  // kx = strafe right (+), kz = forward (+)
    if (keys['w'] || keys['arrowup'])    kz += 1;
    if (keys['s'] || keys['arrowdown'])  kz -= 1;
    if (keys['a'] || keys['arrowleft'])  kx -= 1;
    if (keys['d'] || keys['arrowright']) kx += 1;
    if (kx || kz) {
      const len = Math.hypot(kx, kz);
      kx /= len; kz /= len;
      // Pan speed scales with current zoom so it feels consistent at any distance.
      const panSpeed = cam.distance * 0.55 * dt;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      // Camera-relative forward (toward target) in world XZ = (-sin yaw, -cos yaw);
      // right = (cos yaw, -sin yaw). kz is the "forward" axis (W = -kz).
      const dx = (kx * cy + kz * -sy) * panSpeed;
      const dz = (kx * -sy + kz * -cy) * panSpeed;
      ROOM_CENTER.x = Math.max(PAN_LIMIT.xMin, Math.min(PAN_LIMIT.xMax, ROOM_CENTER.x + dx));
      ROOM_CENTER.z = Math.max(PAN_LIMIT.zMin, Math.min(PAN_LIMIT.zMax, ROOM_CENTER.z + dz));
      cam.target.x  = Math.max(PAN_LIMIT.xMin, Math.min(PAN_LIMIT.xMax, cam.target.x + dx));
      cam.target.z  = Math.max(PAN_LIMIT.zMin, Math.min(PAN_LIMIT.zMax, cam.target.z + dz));
    }
  }

  updateCameraFromCam();

  // Goose removed: no proximity scan, no beak arming, no near-orb.

  // Bob letters & candles to make them findable (use stored baseY — no drift)
  game.interactables.forEach(o => {
    if (!o.visible || o.userData.collected) return;
    if (o.userData.kind !== 'letter' && o.userData.kind !== 'candle') return;
    if (o.userData.baseY === undefined) o.userData.baseY = o.position.y;
    const ph = o.userData.bobPhase || 0;
    o.position.y = o.userData.baseY + Math.sin(t * 2.2 + ph) * 0.04;
    o.rotation.y = (o.rotation.y + dt * 0.8) % (Math.PI * 2);
    // Candle flame flicker
    if (o.userData.kind === 'candle') {
      const flame = o.children[o.children.length - 1];
      if (flame && flame.material && flame.material.emissive) {
        flame.material.emissiveIntensity = 0.6 + Math.sin(t * 12 + ph) * 0.15;
        flame.scale.y = 1.0 + Math.sin(t * 9 + ph) * 0.12;
      }
    }
  });

  // Tap-target marker fade
  if (tapMarkerState.t > 0) {
    tapMarkerState.t = Math.max(0, tapMarkerState.t - dt);
    tapMarker.material.opacity = 0.85 * (tapMarkerState.t / tapMarkerState.life);
    tapMarker.rotation.z += dt * 2;
  } else {
    tapMarker.material.opacity = 0;
  }

  fadeUpdate(dt);
  highlightUpdate(dt);
  bubblesUpdate();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ============================================================
//  Confetti
// ============================================================
function showWin() {
  document.getElementById('win-screen').classList.remove('hidden');
  SFX.win();
  const conf = document.getElementById('confetti');
  conf.innerHTML = '';
  const colors = ['#d97b8a', '#f4d55c', '#9ac4e9', '#b8c89a', '#c28dba', '#f4a261'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = (2 + Math.random() * 3) + 's';
    p.style.animationDelay = (Math.random() * 1.2) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    p.style.borderRadius = (Math.random() < 0.5 ? '50%' : '2px');
    conf.appendChild(p);
  }
}

document.getElementById('play-again').addEventListener('click', () => {
  location.reload();
});

// ============================================================
//  Debug labels toggle (button + 'd' keypress)
// ============================================================
{
  const dbtn = document.getElementById('debug-toggle');
  function syncDebugButton() {
    if (!dbtn || !debugLabelsGroup) return;
    dbtn.classList.toggle('active', !!debugLabelsGroup.visible);
  }
  function toggleDebugLabels() {
    if (!debugLabelsGroup) return;
    debugLabelsGroup.visible = !debugLabelsGroup.visible;
    syncDebugButton();
  }
  if (dbtn) dbtn.addEventListener('click', toggleDebugLabels);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      toggleDebugLabels();
    }
  });
  syncDebugButton();
}

// ============================================================
//  Start
// ============================================================
document.getElementById('start-btn').addEventListener('click', () => {
  // Unlock audio on iPad/Safari (requires user gesture).
  const ctx = audioInit();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  // Tiny silent ping to flush the audio graph on iOS.
  tone(880, 0.01, 'sine', 0, 0.001);
  // Kick off the real honk sample download in the background.
  loadHonkBuffer();
  startMusic();

  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  // Goose removed — HONK button stays hidden; the wall painting plays honks.
  setTimeout(() => {
    const h = document.getElementById('hint');
    if (h) h.style.opacity = '0';
  }, 6000);
});

// Touch/click honk button — rapid presses fire fresh honks each time.
{
  const btn = document.getElementById('honk-btn');
  if (btn) {
    const press = (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      triggerBeak();
    };
    const release = () => btn.classList.remove('pressed');
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  }
}

// Hide loading once first frame is up
requestAnimationFrame(() => {
  document.getElementById('loading').classList.add('hidden');
});

animate();
