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
 * Fügt dem Kopf-Group eine geometrische Haar-Form hinzu.
 *
 * Kappe (kurz + lang):
 *   SphereGeometry mit HAIR_R, phi ∈ [π, 2π] (phiStart=π, phiLength=π).
 *   Three.js-Formel: x=−r·cos(φ)·sin(θ), z=r·sin(φ)·sin(θ).
 *   Nach rotateX(π/2): new_y = −old_z = −r·sin(φ)·sin(θ).
 *   Für new_y ≥ 0 (obere Hälfte, Ohrhöhe): sin(φ) ≤ 0 → φ ∈ [π, 2π]. ✓
 *   theta ∈ [cutTheta, π] schneidet vorne bei z = CUT_Z ab.
 *   Beide Schnittkanten fallen exakt auf die Gesichtsscheibenkante (x=±discR, y=0, z=CUT_Z).
 *
 * Vorhang (nur lang):
 *   CylinderGeometry: z = r·cos(θ) → z = CUT_Z bei θ = arccos(CUT_Z/r).
 *   Bogen von rechter Schnittkante (θ=tCut) um Rückseite zur linken (θ=2π−tCut).
 *   Top bei y=0 (nahtlos am Kappenrand), Bottom bei y=−CURTAIN_H (kurz über Hals).
 */
function _addHair(headGroup, style, colorHex) {
  const HAIR_R = 0.607;   // knapp größer als HEAD_R=0.58 → liegt auf dem Kopf auf
  const CUT_Z  = 0.28;    // Gesichtsebene

  const mat = new THREE.MeshLambertMaterial({
    color: colorHex,
    side:  THREE.DoubleSide   // offene Ränder beidseitig sichtbar
  });

  // ── Kappe: obere Hälfte der Haarkugel (y ≥ 0), vorne bei z=CUT_Z ─
  // SphereGeometry: phi [π/2, π] → nach rotateX entspricht das y ≥ 0
  // theta [cutTheta, π] → hinter die Gesichtsscheibe (z ≤ CUT_Z)
  const cutTheta = Math.acos(CUT_Z / HAIR_R);   // ≈ 1.091 rad
  const capGeo = new THREE.SphereGeometry(
    HAIR_R, 22, 16,
    Math.PI, Math.PI,             // phi: π → 2π → obere Hälfte (new_y≥0) nach rotateX
    cutTheta, Math.PI - cutTheta  // theta: Gesichtsschnitt → Hinterpol
  );
  capGeo.rotateX(Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, mat);
  cap.castShadow = true;
  headGroup.add(cap);

  if (style === 'long') {
    // ── Vorhang: Halbzylinder, nahtlos ab Kappenrand y=0 ───────────
    // CylinderGeometry nutzt z = r·cos(θ) → cutTheta = arccos(CUT_Z/r)
    // (Bugfix: vorher fälschlicherweise arcsin verwendet)
    const tCut   = Math.acos(CUT_Z / HAIR_R);   // = cutTheta ≈ 1.091 rad
    const tStart = tCut;                          // rechte Schnittkante (x>0, z=CUT_Z)
    const tLen   = 2 * Math.PI - 2 * tCut;       // Bogen um Rückseite ≈ 4.101 rad (235°)

    const CURTAIN_H = 0.47;   // top=y=0 (Kappenrand), bottom=y=−0.47 (kurz über Hals)
    const curtainGeo = new THREE.CylinderGeometry(
      HAIR_R,          // oben: gleicher Radius wie Kappe → nahtloser Übergang
      HAIR_R * 0.82,   // unten: leicht verjüngt
      CURTAIN_H,
      18, 1,
      true,            // openEnded – keine Deckel
      tStart, tLen
    );
    const curtain = new THREE.Mesh(curtainGeo, mat);
    curtain.position.y = -(CURTAIN_H / 2);   // top=0, bottom=−CURTAIN_H
    curtain.castShadow = true;
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
