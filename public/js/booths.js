import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Booth-Definitionen
// Positionen werden automatisch im Kreis berechnet.
// Namen / minPlayers werden spaeter mit echten Minigames befuellt.
// ─────────────────────────────────────────────────────────────
const CIRCLE_RADIUS = 28;

export const BOOTHS = [
  { id: 1, name: 'Kick & Slap', color: '#e74c3c', accent: '#ffffff', minPlayers: 2 },
  { id: 2, name: 'Facepaint',   color: '#2980b9', accent: '#ffffff', minPlayers: 2 },
  { id: 3, name: 'Polls',       color: '#27ae60', accent: '#f1c40f', minPlayers: 5 },
  { id: 4, name: 'Racealong',   color: '#8e44ad', accent: '#f8c8ff', minPlayers: 2 },
  { id: 5, name: 'Speedmaths', color: '#e67e22', accent: '#ffffff', minPlayers: 2 },
  { id: 6, name: 'Adopt a Pet', color: '#c0392b', accent: '#f1c40f', minPlayers: 1 },
  { id: 7, name: 'Flappy Chopper', color: '#1abc9c', accent: '#ffffff', minPlayers: 1 },
  { id: 8, name: 'Coming Soon', color: '#d63090', accent: '#ffffff', minPlayers: 1 },
];

// Kreis-Positionen + Drehung zur Mitte berechnen
BOOTHS.forEach((booth, i) => {
  const angle = (i / BOOTHS.length) * Math.PI * 2;
  booth.x    = Math.sin(angle) * CIRCLE_RADIUS;
  booth.z    = Math.cos(angle) * CIRCLE_RADIUS;
  booth.rotY = Math.atan2(-booth.x, -booth.z); // Tresen zeigt zur Weltmitte
});

export const PROXIMITY_RADIUS = 6.5;   // Einheiten – ab hier gilt: "am Stand"

// ─────────────────────────────────────────────────────────────
// BoothManager – Verwaltung aller Staende
// ─────────────────────────────────────────────────────────────
export class BoothManager {
  constructor(scene) {
    this.scene      = scene;
    this.entries    = [];     // [{ id, booth, group }]
    this.counts     = {};     // { boothId: number }
    BOOTHS.forEach(b => { this.counts[b.id] = 0; });

    this._build();
    this._buildCenterDecoration();
  }

  // ── Naehester Stand pruefen ─────────────────────────────────
  /** @returns {object|null} Booth-Objekt oder null */
  checkProximity(playerPos) {
    let nearest = null, nearestDist = Infinity;
    BOOTHS.forEach(booth => {
      const d = Math.hypot(playerPos.x - booth.x, playerPos.z - booth.z);
      if (d < PROXIMITY_RADIUS && d < nearestDist) {
        nearest = booth; nearestDist = d;
      }
    });
    return nearest;
  }

  // ── Spielerzahlen aktualisieren ─────────────────────────────
  updateCounts(counts) {
    this.counts = { ...counts };
    this.entries.forEach(({ id, booth, group }) => {
      const n = counts[id] || 0;
      const cm = group.userData.countMesh;
      if (cm) _updateCountTexture(cm, n, booth.minPlayers);
    });
  }

  // ── Billboards zur Kamera drehen ───────────────────────────
  updateBillboards(camera) {
    this.entries.forEach(({ group }) => {
      const cm = group.userData.countMesh;
      if (cm) cm.lookAt(camera.position);
      const sm = group.userData.signMesh;
      if (sm) sm.lookAt(camera.position);
    });
  }

  // ── Internen Aufbau ─────────────────────────────────────────
  _build() {
    BOOTHS.forEach(booth => {
      const group = _createBoothGroup(booth);
      this.scene.add(group);
      this.entries.push({ id: booth.id, booth, group });
    });
  }

  // Mittiges Dekorations-Element (Kirmes-Mast)
  _buildCenterDecoration() {
    const g = new THREE.Group();

    // Mast
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 8, 12),
      new THREE.MeshLambertMaterial({ color: 0xd4a017 })
    );
    mast.position.y = 4;
    mast.castShadow = true;
    g.add(mast);

    // Stern oben
    const starGeo = _buildStarGeometry(1.0, 0.45, 5, 0.4);
    const star = new THREE.Mesh(starGeo, new THREE.MeshLambertMaterial({ color: 0xf1c40f }));
    star.position.y = 8.6;
    star.castShadow = true;
    g.add(star);

    // Fahnen-Dreiecke am Mast
    const flagColors = [0xe74c3c, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const flag = new THREE.Mesh(
        new THREE.CylinderGeometry(0, 0.45, 1.0, 3),
        new THREE.MeshLambertMaterial({ color: flagColors[i] })
      );
      flag.position.set(Math.sin(angle) * 0.9, 6.5, Math.cos(angle) * 0.9);
      g.add(flag);
    }

    // Bodenscheibe
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.4, 0.18, 16),
      new THREE.MeshLambertMaterial({ color: 0xc8a97d })
    );
    base.position.y = 0.09;
    g.add(base);

    // Umgebungsring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.5, 3.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xf1c40f, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    g.add(ring);

    this.scene.add(g);
  }
}

// ─────────────────────────────────────────────────────────────
// Stand-Gruppe bauen
// ─────────────────────────────────────────────────────────────
function _createBoothGroup(booth) {
  const g     = new THREE.Group();
  const col   = new THREE.Color(booth.color);
  const acc   = new THREE.Color(booth.accent);
  const mainM = new THREE.MeshLambertMaterial({ color: col });
  const woodM = new THREE.MeshLambertMaterial({ color: 0xc8a060 });
  const darkM = new THREE.MeshLambertMaterial({ color: 0x8b5e20 });

  // ── Rueckwand ─────────────────────────────────────────────
  const back = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 0.25), mainM);
  back.position.set(0, 1.75, -2);
  back.castShadow = true;
  g.add(back);

  // ── Seitenwaende ──────────────────────────────────────────
  [-2.35, 2.35].forEach(x => {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.5, 4), mainM);
    side.position.set(x, 1.75, 0);
    side.castShadow = true;
    g.add(side);
  });

  // ── Boden des Standes ─────────────────────────────────────
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.08, 4), woodM);
  floor.position.set(0, 0.04, 0);
  floor.receiveShadow = true;
  g.add(floor);

  // ── Tresen ────────────────────────────────────────────────
  const counter = new THREE.Mesh(new THREE.BoxGeometry(5, 1.05, 0.45), darkM);
  counter.position.set(0, 0.52, 2.25);
  counter.castShadow = true;
  g.add(counter);

  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.65), woodM);
  counterTop.position.set(0, 1.08, 2.3);
  g.add(counterTop);

  // ── Gestreiftes Dach (Hauptflaeche) ───────────────────────
  const roofTex = _stripeTexture(booth.color, booth.accent);
  const roofM   = new THREE.MeshLambertMaterial({ map: roofTex });
  const roof    = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.18, 5.2), roofM);
  roof.position.set(0, 3.65, -0.1);
  roof.castShadow = true;
  g.add(roof);

  // Vordaach (leicht geneigt)
  const awning = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.12, 1.6), roofM);
  awning.position.set(0, 3.28, 2.7);
  awning.rotation.x = -0.28;
  awning.castShadow = true;
  g.add(awning);

  // ── Eckpfosten mit Fahnen ─────────────────────────────────
  [-2.3, 2.3].forEach(x => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 4.2, 8),
      new THREE.MeshLambertMaterial({ color: col })
    );
    pole.position.set(x, 2.1, 2.3);
    pole.castShadow = true;
    g.add(pole);

    // Dreieckige Fahne
    const flag = new THREE.Mesh(
      new THREE.CylinderGeometry(0, 0.35, 0.75, 3),
      new THREE.MeshLambertMaterial({ color: acc })
    );
    flag.position.set(x, 4.55, 2.3);
    g.add(flag);
  });

  // Querfaden zwischen Pfosten mit kleinen Wimpeln
  for (let t = 0; t <= 4; t++) {
    const wx = -2.3 + t * (4.6 / 4);
    const wimpel = new THREE.Mesh(
      new THREE.CylinderGeometry(0, 0.2, 0.5, 3),
      new THREE.MeshLambertMaterial({ color: t % 2 === 0 ? col : acc })
    );
    wimpel.position.set(wx, 4.22, 2.3);
    g.add(wimpel);
  }

  // ── Schild ────────────────────────────────────────────────
  const signMesh = _createSign(booth);
  signMesh.position.set(0, 4.6, -1.95);
  g.add(signMesh);
  g.userData.signMesh = signMesh;

  // ── Spieler-Zaehler (Billboard) ───────────────────────────
  const countMesh = _createCountMesh(0, booth.minPlayers);
  countMesh.position.set(0, 5.6, 0);
  g.add(countMesh);
  g.userData.countMesh = countMesh;

  // ── Positionierung ────────────────────────────────────────
  g.position.set(booth.x, 0, booth.z);
  g.rotation.y = booth.rotY;
  g.userData.boothId = booth.id;

  return g;
}

// ─────────────────────────────────────────────────────────────
// Gestreiftes Dach-Muster
// ─────────────────────────────────────────────────────────────
function _stripeTexture(color1, color2) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const sw = 32;
  for (let i = 0; i < c.width / sw; i++) {
    ctx.fillStyle = i % 2 === 0 ? color1 : color2;
    ctx.fillRect(i * sw, 0, sw, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ─────────────────────────────────────────────────────────────
// Schild-Mesh (haengt an Rueckwand)
// ─────────────────────────────────────────────────────────────
function _createSign(booth) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');

  // Hintergrund
  ctx.fillStyle = booth.color;
  ctx.fillRect(0, 0, 512, 128);

  // Rahmen
  ctx.strokeStyle = booth.accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 118);

  // Text
  ctx.fillStyle = booth.accent;
  ctx.font = 'bold 58px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(booth.name, 256, 66);

  const tex  = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 0.95),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  mesh.userData.boothId   = booth.id;
  mesh.userData.signCanvas = c;
  mesh.userData.signCtx   = ctx;
  mesh.userData.booth     = booth;
  return mesh;
}

// ─────────────────────────────────────────────────────────────
// Spieler-Zaehler Billboard
// ─────────────────────────────────────────────────────────────
function _createCountMesh(count, minPlayers) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const ctx = c.getContext('2d');
  _drawCountCanvas(ctx, count, minPlayers);

  const tex  = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.62),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
  );
  mesh.renderOrder = 999;
  mesh.userData = { canvas: c, ctx, tex, minPlayers };
  return mesh;
}

function _updateCountTexture(mesh, count, minPlayers) {
  _drawCountCanvas(mesh.userData.ctx, count, minPlayers);
  mesh.userData.tex.needsUpdate = true;
}

function _drawCountCanvas(ctx, count, minPlayers) {
  const W = 256, H = 72;
  ctx.clearRect(0, 0, W, H);
  const enough = count >= minPlayers;

  // Pill-Hintergrund
  ctx.fillStyle = enough ? 'rgba(22,163,74,0.9)' : 'rgba(15,23,42,0.75)';
  _pill(ctx, 4, 8, W - 8, H - 14, 12);
  ctx.fill();

  // Rand wenn voll
  if (enough) {
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 3;
    _pill(ctx, 4, 8, W - 8, H - 14, 12);
    ctx.stroke();
  }

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 26px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const icon = enough ? '✓' : '👥';
  ctx.fillText(`${icon}  ${count} / ${minPlayers}`, W / 2, H / 2 - 1);
}

function _pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─────────────────────────────────────────────────────────────
// Stern-Geometrie fuer die Mitteldekoration
// ─────────────────────────────────────────────────────────────
function _buildStarGeometry(outerR, innerR, points, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r     = i % 2 === 0 ? outerR : innerR;
    const x     = Math.cos(angle) * r;
    const y     = Math.sin(angle) * r;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

// ─────────────────────────────────────────────────────────────
// Schilder-Text aktualisieren (wenn Minigame-Namen bekannt)
// ─────────────────────────────────────────────────────────────
export function updateBoothName(boothManager, boothId, newName) {
  const entry = boothManager.entries.find(e => e.id === boothId);
  if (!entry) return;
  entry.booth.name = newName;
  const signMesh = entry.group.userData.signMesh;
  if (!signMesh) return;
  const { signCtx, signCanvas, booth } = signMesh.userData;
  signCtx.clearRect(0, 0, 512, 128);
  signCtx.fillStyle = booth.color;
  signCtx.fillRect(0, 0, 512, 128);
  signCtx.strokeStyle = booth.accent;
  signCtx.lineWidth = 10;
  signCtx.strokeRect(5, 5, 502, 118);
  signCtx.fillStyle = booth.accent;
  signCtx.font = 'bold 58px Arial, sans-serif';
  signCtx.textAlign = 'center';
  signCtx.textBaseline = 'middle';
  signCtx.fillText(newName, 256, 66);
  signMesh.material.map.needsUpdate = true;
}
