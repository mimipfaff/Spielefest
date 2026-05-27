import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Szene
// ─────────────────────────────────────────────────────────────
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9dd8f0);
  scene.fog        = new THREE.FogExp2(0x9dd8f0, 0.009);
  return scene;
}

// ─────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return renderer;
}

// ─────────────────────────────────────────────────────────────
// Kamera
// ─────────────────────────────────────────────────────────────
export function createCamera() {
  const cam = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    300
  );
  cam.position.set(0, 8, 10);

  window.addEventListener('resize', () => {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
  });
  return cam;
}

// ─────────────────────────────────────────────────────────────
// Beleuchtung
// ─────────────────────────────────────────────────────────────
export function setupLighting(scene) {
  // Weiches Umgebungslicht (leicht warm)
  scene.add(new THREE.AmbientLight(0xfff8e8, 0.65));

  // Sonne (warmes Nachmittagslicht)
  const sun = new THREE.DirectionalLight(0xffe8c0, 1.4);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near  = 1;
  sun.shadow.camera.far   = 160;
  sun.shadow.camera.left  = -60;
  sun.shadow.camera.right =  60;
  sun.shadow.camera.top   =  60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.bias = -0.001;
  scene.add(sun);
}

// ─────────────────────────────────────────────────────────────
// Boden (100 x 100 Einheiten)
// ─────────────────────────────────────────────────────────────
export function createFloor(scene) {
  // Weisser Boden
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshLambertMaterial({ color: 0xf9f9f9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);

  // Feines Gitter (hilft bei der raeumlichen Orientierung)
  const grid = new THREE.GridHelper(100, 50, 0xd0d0d0, 0xe8e8e8);
  grid.position.y = 0.002;
  scene.add(grid);

  // Weltgrenze als Linie
  const pts = [
    new THREE.Vector3(-50, 0.003, -50),
    new THREE.Vector3( 50, 0.003, -50),
    new THREE.Vector3( 50, 0.003,  50),
    new THREE.Vector3(-50, 0.003,  50),
    new THREE.Vector3(-50, 0.003, -50)
  ];
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xaaaaaa })
  ));
}

// ─────────────────────────────────────────────────────────────
// Objekt-Mesh aus Daten bauen
// faceTextures = { front, back, left, right, top, bottom } als data-URLs
// faceCanvases = gleiche Keys als HTMLCanvasElement (optional, schneller lokal)
// ─────────────────────────────────────────────────────────────
const FACE_MAT_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back'];

export function buildObjectMesh(data, transparent = false) {
  const { width = 2, height = 2, depth = 1 } = data;
  const geo  = new THREE.BoxGeometry(width, height, depth);

  const mats = FACE_MAT_ORDER.map(f => {
    const mat = new THREE.MeshLambertMaterial({
      transparent,
      opacity: transparent ? 0.55 : 1.0
    });

    // Bevorzuge Canvas-Textur (kein base64-Decode noetig)
    const canvas = data.faceCanvases?.[f];
    const url    = data.faceTextures?.[f];

    if (canvas) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      mat.map = tex;
    } else if (url) {
      const tex = new THREE.TextureLoader().load(url);
      tex.minFilter = THREE.LinearFilter;
      mat.map = tex;
    } else {
      mat.color.set(transparent ? 0x7dd3fc : 0xf5f5f5);
    }
    return mat;
  });

  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow   = !transparent;
  mesh.receiveShadow = !transparent;
  mesh.userData.objectId = data.id || null;
  return mesh;
}

// ─────────────────────────────────────────────────────────────
// Objekt zur Welt hinzufuegen
// ─────────────────────────────────────────────────────────────
export function addWorldObject(scene, data) {
  const mesh = buildObjectMesh(data);
  const h    = data.height || 2;
  mesh.position.set(data.x || 0, h / 2, data.z || 0);
  scene.add(mesh);
  return mesh;
}
