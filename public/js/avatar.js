import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Farben
// ─────────────────────────────────────────────────────────────
const COL_SKIN  = 0xffce9e;   // warmes Animal-Crossing-Hautbeige
const COL_LEGS  = 0x3d2f1e;   // dunkles Braun (Hose)
const COL_SHOES = 0x2a1f14;   // fast schwarz (Schuhe)

// ─────────────────────────────────────────────────────────────
/**
 * Erstellt einen Animal-Crossing-artigen Avatar.
 *
 * Aufbau (Füße auf y = 0):
 *   Kopf  : Box      1.12 × 1.08 × 0.98   y ≈ 2.28
 *   Körper: Capsule  r=0.52  l=0.42        y ≈ 1.22
 *   Arme  : Capsule  r=0.19  l=0.30        Pivot y=1.72, x=±0.74
 *   Beine : Capsule  r=0.21  l=0.28        Pivot y=0.74
 *   Schuhe: flache Kugel an Bein-Enden
 *
 * @returns {{ group, lArmPivot, rArmPivot, lLegPivot, rLegPivot, body, head }}
 */
export function createAvatarMesh(faceData, bodyColor = 0x5b9bd5, skinColor = COL_SKIN, hairStyle = 'none', hairColor = '#1a0a05') {
  const group = new THREE.Group();

  const skinM  = new THREE.MeshLambertMaterial({ color: skinColor });
  const bodyM  = new THREE.MeshLambertMaterial({ color: bodyColor });
  const legM   = new THREE.MeshLambertMaterial({ color: COL_LEGS  });
  const shoeM  = new THREE.MeshLambertMaterial({ color: COL_SHOES });

  // ── Kopf (Kugel mit abgeschnittener Vorderseite + flache Gesichtsscheibe) ──
  const head = new THREE.Group();
  head.position.y = 2.58;   // Abstand Körper↔Kopf um 75 % reduziert (2× halbiert)
  group.add(head);

  // Schnittparameter: Kugel wird bei z = CUT_Z abgeschnitten
  const HEAD_R   = 0.58;
  const CUT_Z    = 0.28;
  const cutTheta = Math.acos(CUT_Z / HEAD_R);          // Winkel ab Nordpol zum Schnitt
  const discR    = Math.sqrt(HEAD_R * HEAD_R - CUT_Z * CUT_Z);  // ≈ 0.508

  // Nur der hintere Teil der Kugel (z < CUT_Z)
  const headGeo = new THREE.SphereGeometry(
    HEAD_R, 22, 16,
    0, Math.PI * 2,
    cutTheta, Math.PI - cutTheta
  );
  headGeo.rotateX(Math.PI / 2);   // Nordpol (+y) → Vorne (+z), sodass der Schnitt vorne liegt

  const headSphere = new THREE.Mesh(headGeo, skinM);
  headSphere.castShadow = true;
  head.add(headSphere);

  // Flache Gesichtsscheibe genau am Schnitt
  const faceMat = faceData
    ? _faceMat(faceData)
    : new THREE.MeshLambertMaterial({ color: skinColor });
  const faceDisc = new THREE.Mesh(new THREE.CircleGeometry(discR, 40), faceMat);
  faceDisc.position.z = CUT_Z + 0.005;
  faceDisc.renderOrder = 1;   // nach Haar rendern → Gesicht immer sichtbar über Haar
  head.add(faceDisc);

  // ── Haare (optional, auf den Kopf-Gruppen-Origin bezogen) ──
  if (hairStyle && hairStyle !== 'none') {
    _addHair(head, hairStyle, hairColor);
  }

  // ── Hals (kleiner Zylinder zwischen Körper und Kopf) ────────
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.21, 0.20, 10),
    skinM
  );
  neck.position.y = 2.00;   // Spanne: 1.90 – 2.10  (taucht leicht in Körper & Kopf ein)
  neck.castShadow = true;
  group.add(neck);

  // ── Körper (runde Kapsel) ──────────────────────────────────
  // CapsuleGeometry(radius, length, capSegments, radialSegments)
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.52, 0.42, 8, 14),
    bodyM
  );
  body.position.y = 1.22;
  body.castShadow = true;
  group.add(body);

  // ── Arme (Pivot an Schulter) ───────────────────────────────
  const makeArmGeo = () => {
    const g = new THREE.CapsuleGeometry(0.19, 0.30, 5, 10);
    g.translate(0, -(0.15 + 0.19), 0);   // Pivot → oberes Ende
    return g;
  };

  const lArmPivot = new THREE.Group();
  lArmPivot.position.set(-0.74, 1.72, 0);
  lArmPivot.add(new THREE.Mesh(makeArmGeo(), skinM));
  group.add(lArmPivot);

  const rArmPivot = new THREE.Group();
  rArmPivot.position.set(0.74, 1.72, 0);
  rArmPivot.add(new THREE.Mesh(makeArmGeo(), skinM));
  group.add(rArmPivot);

  // ── Beine + Schuhe (Pivot an Hüfte) ───────────────────────
  const makeLegGroup = () => {
    const g = new THREE.Group();

    // Bein-Capsule
    const legGeo = new THREE.CapsuleGeometry(0.21, 0.28, 5, 10);
    legGeo.translate(0, -(0.14 + 0.21), 0);   // Pivot → Hüfte
    g.add(new THREE.Mesh(legGeo, legM));

    // Schuh (flach gedrückte Kugel am Fuß)
    const shoeGeo = new THREE.SphereGeometry(0.24, 10, 6);
    shoeGeo.scale(1, 0.55, 1.30);
    const shoe = new THREE.Mesh(shoeGeo, shoeM);
    shoe.position.set(0, -(0.28 + 0.42 - 0.06), 0.05);   // Fußende + leicht vorne
    g.add(shoe);
    return g;
  };

  const lLegPivot = new THREE.Group();
  lLegPivot.position.set(-0.22, 0.74, 0);
  lLegPivot.add(makeLegGroup());
  group.add(lLegPivot);

  const rLegPivot = new THREE.Group();
  rLegPivot.position.set(0.22, 0.74, 0);
  rLegPivot.add(makeLegGroup());
  group.add(rLegPivot);

  return { group, lArmPivot, rArmPivot, lLegPivot, rLegPivot, body, head, faceDisc };
}

// ─────────────────────────────────────────────────────────────
/**
 * Billboard-Namensschild (lookAt muss pro Frame aufgerufen werden).
 */
export function createNameTag(name) {
  const W = 256, H = 64;
  const c   = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  _pill(ctx, 4, 10, W - 8, H - 18, 10);
  ctx.fill();

  ctx.fillStyle    = '#ffffff';
  ctx.font         = 'bold 26px Arial, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.substring(0, 15), W / 2, H / 2 - 2);

  const tex  = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.42),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
  );
  mesh.renderOrder     = 999;
  mesh.userData.isNameTag = true;
  return mesh;
}

// ─────────────────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────────────────
function _faceMat(faceData) {
  const tex = new THREE.TextureLoader().load(faceData);
  tex.colorSpace = THREE.SRGBColorSpace;   // verhindert ausgeblichene Farben in der 3D-Welt
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  return new THREE.MeshBasicMaterial({ map: tex });
}


/**
 * Fügt dem Kopf-Group eine Haar-Geometrie hinzu.
 * Koordinaten sind im lokalen Raum der headGroup:
 *   y=0  = Kopfmitte,  y=+HEAD_R = Scheitel
 *   z=+CUT_Z ≈ +0.285 = Gesichtsscheibe (vorne)
 *   z=-HEAD_R = Hinterkopf
 *
 * depthWrite:false → Haar schreibt nicht in den Tiefenpuffer.
 * Die Gesichtsscheibe (renderOrder=1) rendert danach in einen Puffer
 * ohne Haar-Tiefe → besteht Tiefentest und überdeckt das Haar korrekt.
 *
 * Kappe: Mitte bei z=0, scale_z=0.80
 *   → Vorderkante bei +0.496 (geometrisch vor Scheibe), aber Scheibe überschreibt ✓
 *   → An Gesichtskante (x≈0.509): Haar z=+0.306 > Kopfsphäre z=0.278 → sichtbar ✓
 * Vorhang: Mitte bei z=-0.30
 *   → Auf Halshöhe (y=-0.58): Vorhang z=+0.174 < Hals-Vorderseite (≈0.21) → Hals vorne ✓
 */
function _addHair(headGroup, style, colorHex) {
  // depthWrite:false → Haar schreibt keinen Tiefenwert, Gesichtsscheibe rendert korrekt drüber
  const mat = new THREE.MeshLambertMaterial({ color: colorHex, depthWrite: false });

  // ── Kappe (kurz UND lang) ────────────────────────────────────
  // Mitte bei z=0 → reicht geometrisch bis an Gesichtskante und darüber hinaus,
  // wird aber im Gesichtsbereich von der Scheibe (renderOrder=1) überblendet.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10), mat);
  cap.position.set(0, 0.06, 0);
  cap.scale.set(1.05, 0.92, 0.80);
  headGroup.add(cap);

  if (style === 'long') {
    // ── Vorhang (nur lang) ───────────────────────────────────
    // Mitte bei z=-0.30 → Vorhang-Vorderseite auf Halshöhe hinter dem Hals
    const curtain = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), mat);
    curtain.position.set(0, -0.32, -0.30);
    curtain.scale.set(1.00, 1.42, 0.80);
    headGroup.add(curtain);
  }
}

function _pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
