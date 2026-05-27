import * as THREE from 'three';
import { BOOTHS } from './booths.js';

// ─────────────────────────────────────────────────────────────
// Terrain-Konstanten
// ─────────────────────────────────────────────────────────────
const FLAT_UNTIL  = 34;   // Absolut flach bis hierher (Spielfeld)
const HILL_BEGIN  = 38;   // Hügel beginnen sanft
const HILL_END    = 54;   // Außenrand der Hügel
const MAX_HILL_H  = 14;   // Maximale Hügelhöhe in Einheiten

// ─────────────────────────────────────────────────────────────
// Haupt-Einstiegspunkt
// ─────────────────────────────────────────────────────────────
export function setupEnvironment(scene) {
  _setSky(scene);
  _buildTerrain(scene);
  _plantTrees(scene);
  _scatterFlowers(scene);
  _addPathRing(scene);
}

// ─────────────────────────────────────────────────────────────
// Terrain-Höhe an beliebiger Stelle (für Objekt-Placement)
// ─────────────────────────────────────────────────────────────
export function getTerrainHeight(x, z) {
  const dist = Math.sqrt(x * x + z * z);
  if (dist <= FLAT_UNTIL) return 0;

  if (dist <= HILL_BEGIN) {
    // Weicher Übergang
    const t = (dist - FLAT_UNTIL) / (HILL_BEGIN - FLAT_UNTIL);
    return t * t * t * 0.4;
  }

  const t     = Math.min(1, (dist - HILL_BEGIN) / (HILL_END - HILL_BEGIN));
  const base  = t * t * MAX_HILL_H;
  // Natürliche Unregelmäßigkeit der Hügel
  const noise = Math.sin(x * 0.21 + 1.4) * Math.cos(z * 0.18 + 0.9) * t * 2.2
              + Math.sin(x * 0.08 - z * 0.11) * t * 1.1;
  return Math.max(0, base + noise);
}

// ─────────────────────────────────────────────────────────────
// Himmel & Nebel
// ─────────────────────────────────────────────────────────────
function _setSky(scene) {
  scene.background = new THREE.Color(0x9dd8f0);
  scene.fog        = new THREE.FogExp2(0x9dd8f0, 0.009);
}

// ─────────────────────────────────────────────────────────────
// Terrain-Mesh (ersetze den weißen Boden)
// ─────────────────────────────────────────────────────────────
function _buildTerrain(scene) {
  // Alten Boden / Grid entfernen
  scene.children
    .filter(c => c.name === 'floor' || c.isGridHelper || c.isLine)
    .forEach(c => scene.remove(c));

  const SEG = 90;
  const geo = new THREE.PlaneGeometry(112, 112, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position.array;

  // Vertex-Farben für Farbvariation Wiese ↔ Hügel
  const colors = new Float32Array(pos.length);

  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const z = pos[i + 2];
    pos[i + 1] = getTerrainHeight(x, z);

    // Farbe: helles Wiesengrün → dunkleres Hügelgrün
    const dist = Math.sqrt(x * x + z * z);
    const t    = Math.min(1, Math.max(0, (dist - FLAT_UNTIL) / (HILL_END - FLAT_UNTIL)));
    colors[i]     = 0.30 + t * 0.04;   // R
    colors[i + 1] = 0.60 - t * 0.12;  // G
    colors[i + 2] = 0.18 + t * 0.01;  // B
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
}

// ─────────────────────────────────────────────────────────────
// Pfad-Ring um den Mittelpunkt (markiert die Lauf-Zone)
// ─────────────────────────────────────────────────────────────
function _addPathRing(scene) {
  // Heller Kiesweg-Ring
  const geo  = new THREE.RingGeometry(31, 32.8, 80);
  const mat  = new THREE.MeshBasicMaterial({ color: 0xd4b483, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.005;
  scene.add(ring);

  // Innerer Plattenweg um die Mitte
  const inner  = new THREE.RingGeometry(3.5, 5.0, 32);
  const iMesh  = new THREE.Mesh(inner, new THREE.MeshBasicMaterial({ color: 0xc8a87a, side: THREE.DoubleSide }));
  iMesh.rotation.x = -Math.PI / 2;
  iMesh.position.y = 0.004;
  scene.add(iMesh);
}

// ─────────────────────────────────────────────────────────────
// Bäume & Büsche
// ─────────────────────────────────────────────────────────────
function _plantTrees(scene) {
  const boothZones = BOOTHS.map(b => ({ x: b.x, z: b.z, r: 8 }));

  const isTooClose = (x, z) =>
    boothZones.some(b => Math.hypot(x - b.x, z - b.z) < b.r) ||
    Math.hypot(x, z) < 6;  // Mitte freihalten

  // ── Äußerer Ring (Hügelkranz) ──────────────────────────────
  for (let i = 0; i < 58; i++) {
    const angle  = (i / 58) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
    const radius = 36 + Math.random() * 13;
    const x      = Math.sin(angle) * radius;
    const z      = Math.cos(angle) * radius;
    const s      = 0.75 + Math.random() * 0.9;
    const y      = getTerrainHeight(x, z);
    const tree   = Math.random() < 0.55 ? _firTree(s) : _oakTree(s);
    tree.position.set(x, y, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);
  }

  // ── Innere Wiesen-Bäume (locker verstreut) ──────────────────
  let placed = 0, tries = 0;
  while (placed < 22 && tries++ < 600) {
    const angle  = Math.random() * Math.PI * 2;
    const radius = 11 + Math.random() * 19;
    const x      = Math.sin(angle) * radius;
    const z      = Math.cos(angle) * radius;
    if (isTooClose(x, z)) continue;

    const s    = 0.55 + Math.random() * 0.65;
    const tree = Math.random() < 0.35 ? _firTree(s)
               : Math.random() < 0.6  ? _oakTree(s)
                                       : _bush(s * 0.7);
    tree.position.set(x, getTerrainHeight(x, z), z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);
    placed++;
  }
}

// ── Tanne ──────────────────────────────────────────────────────
function _firTree(s = 1) {
  const g   = new THREE.Group();
  const trM = new THREE.MeshLambertMaterial({ color: 0x5c3317 });

  // Stamm
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13 * s, 0.19 * s, 1.6 * s, 7),
    trM
  );
  trunk.position.y = 0.8 * s;
  trunk.castShadow = true;
  g.add(trunk);

  // 3 übereinander gestapelte Kegel (werden heller nach oben)
  const layerColors = [0x1a4a14, 0x286320, 0x357a2a];
  const layerProps  = [
    { r: 1.70, h: 2.6, y: 2.1 },
    { r: 1.25, h: 2.2, y: 3.6 },
    { r: 0.80, h: 1.8, y: 4.9 },
  ];
  layerProps.forEach(({ r, h, y }, i) => {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r * s, h * s, 8),
      new THREE.MeshLambertMaterial({ color: layerColors[i] })
    );
    cone.position.y = y * s;
    cone.castShadow = true;
    g.add(cone);
  });

  return g;
}

// ── Eiche ──────────────────────────────────────────────────────
function _oakTree(s = 1) {
  const g   = new THREE.Group();
  const trM = new THREE.MeshLambertMaterial({ color: 0x6b4226 });

  // Stamm
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.20 * s, 0.28 * s, 2.4 * s, 8),
    trM
  );
  trunk.position.y = 1.2 * s;
  trunk.castShadow = true;
  g.add(trunk);

  // Haupt-Kugel
  const mainM = new THREE.MeshLambertMaterial({ color: 0x2d5a1b });
  const main  = new THREE.Mesh(new THREE.SphereGeometry(1.7 * s, 9, 7), mainM);
  main.position.y = 3.9 * s;
  main.castShadow = true;
  g.add(main);

  // Neben-Kugeln für organische Form
  const subM = new THREE.MeshLambertMaterial({ color: 0x224d14 });
  [[-1.0, 0.0, 0.7], [1.1, 0.2, -0.5], [0.3, 1.0, 0.9], [-0.5, -0.4, -1.0]].forEach(([ox, oy, oz]) => {
    const sub = new THREE.Mesh(
      new THREE.SphereGeometry((0.95 + Math.random() * 0.35) * s, 7, 5),
      subM
    );
    sub.position.set(ox * s, (3.9 + oy) * s, oz * s);
    sub.castShadow = true;
    g.add(sub);
  });

  return g;
}

// ── Busch ─────────────────────────────────────────────────────
function _bush(s = 0.6) {
  const g = new THREE.Group();
  const cols = [0x2e6b1a, 0x3d8028, 0x4a9030];
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry((0.48 + Math.random() * 0.3) * s, 7, 5),
      new THREE.MeshLambertMaterial({ color: cols[i % 3] })
    );
    sphere.position.set(
      Math.sin(a) * 0.28 * s,
      (0.38 + Math.random() * 0.18) * s,
      Math.cos(a) * 0.28 * s
    );
    sphere.castShadow = true;
    g.add(sphere);
  }
  return g;
}

// ─────────────────────────────────────────────────────────────
// Blumen auf der Wiese
// ─────────────────────────────────────────────────────────────
function _scatterFlowers(scene) {
  const COLORS = [0xff6b6b, 0xffd93d, 0xffc8e8, 0xffffff, 0xff9f43, 0xa29bfe];

  // Alle Blüten als InstancedMesh → 1 Draw-Call
  const geo  = new THREE.SphereGeometry(0.09, 4, 3);
  const mats = COLORS.map(c => new THREE.MeshBasicMaterial({ color: c }));

  // Pro Farbe ein InstancedMesh
  const FLOWERS_PER_COLOR = 60;
  mats.forEach((mat, ci) => {
    const im     = new THREE.InstancedMesh(geo, mat, FLOWERS_PER_COLOR);
    const dummy  = new THREE.Object3D();
    let placed   = 0;
    let tries    = 0;

    while (placed < FLOWERS_PER_COLOR && tries++ < 1000) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = 4 + Math.random() * 42;
      const x      = Math.sin(angle) * radius;
      const z      = Math.cos(angle) * radius;
      const y      = getTerrainHeight(x, z);
      if (y > 5) { tries++; continue; }  // keine Blumen auf steilen Hügeln

      dummy.position.set(x, y + 0.12, z);
      dummy.updateMatrix();
      im.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    im.count = placed;
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
  });
}
