// ─────────────────────────────────────────────────────────────
// Pets – 3D-Haustiere (Stand 6: Adopt a Pet)
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createAvatarMesh } from './avatar.js';

export const PET_DEFS = [
  { id: 'wallace',   name: 'Wallace',   emoji: '🐧', desc: 'Pinguin'      },
  { id: 'bally',     name: 'Bally',     emoji: '🔵', desc: 'Kugel'        },
  { id: 'baby',      name: 'Baby',      emoji: '👶', desc: 'Baby'         },
  { id: 'simba',     name: 'Simba',     emoji: '🦁', desc: 'Löwe'         },
  { id: 'karl',      name: 'Karl',      emoji: '🚗', desc: 'PKW'          },
  { id: 'wikinger',  name: 'Wikinger',  emoji: '⛑',  desc: 'Wikingerhelm' },
  { id: 'elli',      name: 'Elli',      emoji: '🐘', desc: 'Elefant'      },
  { id: 'bello',     name: 'Bello',     emoji: '🐕', desc: 'Hund'         },
  { id: 'mathebuch', name: 'Mathebuch', emoji: '📐', desc: 'Mathebuch'    },
  { id: 'minime',    name: 'Minime',    emoji: '🧑', desc: 'Mini-Avatar'  },
];

// Abstand hinter dem Spieler (Welteinheiten)
const TRAIL_DIST  = 0.90;
const FOLLOW_DELAY = 0.25;   // Sekunden Verzögerung beim Folgen

// ─────────────────────────────────────────────────────────────
export class PetManager {
  constructor(scene) {
    this.scene = scene;
    this.pets  = new Map();   // socketId → { petId, group, t }
  }

  spawn(socketId, petId, startPos, shirtColor = '#5b9bd5', skinColor = '#ffce9e') {
    if (this.pets.has(socketId)) this.despawn(socketId);
    const group = createPetMesh(petId, shirtColor, skinColor);
    if (!group) return;
    group.scale.setScalar(2);   // doppelte Größe
    if (startPos) group.position.set(startPos.x, startPos.y, startPos.z);
    this.scene.add(group);
    this.pets.set(socketId, { petId, group, t: Math.random() * Math.PI * 2, posHistory: [] });
  }

  despawn(socketId) {
    const p = this.pets.get(socketId);
    if (!p) return;
    this.scene.remove(p.group);
    p.group.traverse(c => {
      if (c.isMesh) {
        c.geometry?.dispose();
        [].concat(c.material).forEach(m => m?.dispose());
      }
    });
    this.pets.delete(socketId);
  }

  despawnAll() {
    [...this.pets.keys()].forEach(id => this.despawn(id));
  }

  /**
   * @param {number} dt          – Delta-Zeit in Sekunden
   * @param {string} selfId      – eigene Socket-ID
   * @param {object} localMesh   – localPlayer.mesh (THREE.Group)
   * @param {Map}    remotePlayers – NetworkManager.remotePlayers
   */
  update(dt, selfId, localMesh, remotePlayers) {
    const now = performance.now() / 1000;

    this.pets.forEach((pet, socketId) => {
      pet.t += dt;

      // Besitzer-Gruppe herausfinden
      const ownerGroup = socketId === selfId
        ? localMesh
        : remotePlayers?.get(socketId)?.group;
      if (!ownerGroup) return;

      const rotY = ownerGroup.rotation.y;

      // Zielpunkt hinter dem Besitzer berechnen und in History schreiben
      const cx = ownerGroup.position.x + Math.sin(rotY + Math.PI + 0.38) * TRAIL_DIST;
      const cz = ownerGroup.position.z + Math.cos(rotY + Math.PI + 0.38) * TRAIL_DIST;
      pet.posHistory.push({ x: cx, z: cz, rotY, t: now });

      // Alte Einträge bereinigen (mehr als DELAY + kleiner Puffer zurückliegend)
      while (pet.posHistory.length > 1 && pet.posHistory[0].t < now - FOLLOW_DELAY - 0.1) {
        pet.posHistory.shift();
      }

      // Position von genau FOLLOW_DELAY Sekunden zurück interpolieren
      const targetT = now - FOLLOW_DELAY;
      const hist    = pet.posHistory;
      let tx = cx, tz = cz, tRot = rotY;

      if (hist.length >= 2) {
        // Letzten Eintrag ≤ targetT suchen
        let i = 0;
        while (i < hist.length - 2 && hist[i + 1].t <= targetT) i++;
        const a0 = hist[i], a1 = hist[i + 1];
        if (a1.t > a0.t) {
          const f = Math.min(1, (targetT - a0.t) / (a1.t - a0.t));
          tx   = a0.x    + (a1.x    - a0.x)    * f;
          tz   = a0.z    + (a1.z    - a0.z)    * f;
          tRot = a0.rotY + (a1.rotY - a0.rotY) * f;
        } else {
          tx = a0.x; tz = a0.z; tRot = a0.rotY;
        }
      } else if (hist.length === 1) {
        tx = hist[0].x; tz = hist[0].z; tRot = hist[0].rotY;
      }

      pet.group.position.x = tx;
      pet.group.position.z = tz;
      pet.group.rotation.y = tRot;

      // Y: Boden-Clamp + Bobbing nur nach OBEN
      const ty  = ownerGroup.position.y;
      const bob = (1 - Math.cos(pet.t * 4.2)) * 0.5 * 0.10;
      pet.group.position.y = Math.max(ty, ty + bob);

      // Pet-spezifische Animation
      _animatePet(pet);
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Per-Pet-Animation
// ─────────────────────────────────────────────────────────────
function _animatePet(pet) {
  const t  = pet.t;
  const ud = pet.group.userData;
  switch (pet.petId) {
    case 'wallace':
      if (ud.lFlip) ud.lFlip.rotation.z =  Math.sin(t * 4.5) * 0.45 - 0.30;
      if (ud.rFlip) ud.rFlip.rotation.z = -Math.sin(t * 4.5) * 0.45 + 0.30;
      break;
    case 'bally':
      if (ud.ball) ud.ball.rotation.x = t * 2.2;   // nur Ball, nicht die Gruppe
      break;
    case 'karl':
      (ud.wheels || []).forEach(w => { w.rotation.x = t * 5; });
      break;
    case 'bello':
      if (ud.tail) ud.tail.rotation.z = Math.sin(t * 9) * 0.55;
      break;
    case 'simba':
      if (ud.tail) ud.tail.rotation.z = Math.sin(t * 3.5) * 0.40;
      break;
    case 'baby':
      if (ud.lArm) ud.lArm.rotation.z =  Math.sin(t * 2.8) * 0.40 + 0.35;
      if (ud.rArm) ud.rArm.rotation.z = -Math.sin(t * 2.8) * 0.40 - 0.35;
      break;
    case 'wikinger':
      if (ud.dome) ud.dome.rotation.y = Math.sin(t * 2) * 0.12;
      break;
  }
}

// ─────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────
export function createPetMesh(petId, shirtColor = '#5b9bd5', skinColor = '#ffce9e') {
  switch (petId) {
    case 'wallace':   return _makeWallace();
    case 'bally':     return _makeBally();
    case 'baby':      return _makeBaby();
    case 'simba':     return _makeSimba();
    case 'karl':      return _makeKarl();
    case 'wikinger':  return _makeWikinger();
    case 'elli':      return _makeElli();
    case 'bello':     return _makeBello();
    case 'mathebuch': return _makeMathebuch();
    case 'minime':    return _makeMinime(shirtColor, skinColor);
    default:          return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────────────────
const _lm  = c => new THREE.MeshLambertMaterial({ color: c });
const _bm  = c => new THREE.MeshBasicMaterial({ color: c });

function _m(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}
function _pos(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

// ─────────────────────────────────────────────────────────────
// 1 – Wallace (Pinguin)
// ─────────────────────────────────────────────────────────────
function _makeWallace() {
  const g = new THREE.Group();
  const black  = _lm(0x111111);
  const white  = _lm(0xf5f5f5);
  const orange = _lm(0xff8c00);

  // Körper
  g.add(_pos(_m(new THREE.CapsuleGeometry(0.09, 0.14, 4, 8), black), 0, 0.15, 0));

  // Bauch
  const belly = _m(new THREE.SphereGeometry(0.07, 8, 6), white);
  belly.scale.set(0.9, 1.1, 0.5);
  g.add(_pos(belly, 0, 0.16, 0.07));

  // Kopf
  g.add(_pos(_m(new THREE.SphereGeometry(0.09, 10, 8), black), 0, 0.37, 0));

  // Augen
  [-0.040, 0.040].forEach(x => {
    g.add(_pos(_m(new THREE.SphereGeometry(0.022, 6, 6), white), x, 0.39, 0.084));
    g.add(_pos(_m(new THREE.SphereGeometry(0.013, 6, 6), black), x, 0.39, 0.095));
  });

  // Schnabel
  const beak = _m(new THREE.ConeGeometry(0.026, 0.055, 5), orange);
  beak.rotation.x = Math.PI / 2;
  g.add(_pos(beak, 0, 0.37, 0.113));

  // Flossen (animiert)
  ['l', 'r'].forEach((side, i) => {
    const flip = new THREE.Group();
    flip.position.set(side === 'l' ? -0.12 : 0.12, 0.22, 0);
    flip.rotation.z = side === 'l' ? -0.30 : 0.30;
    const fm = _m(new THREE.CapsuleGeometry(0.028, 0.09, 4, 6), black);
    fm.position.y = -0.04;
    flip.add(fm);
    g.add(flip);
    g.userData[side + 'Flip'] = flip;
  });

  // Füße
  [-0.045, 0.045].forEach(x => {
    const foot = _m(new THREE.SphereGeometry(0.045, 6, 4), orange);
    foot.scale.set(1.4, 0.28, 1.8);
    g.add(_pos(foot, x, 0.012, 0.04));
  });

  return g;
}

// ─────────────────────────────────────────────────────────────
// 2 – Bally (Kugel)
// ─────────────────────────────────────────────────────────────
function _makeBally() {
  const g = new THREE.Group();

  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  // Weiße Streifen (Kugeldesign)
  ctx.beginPath(); ctx.arc(64, 64, 62, -0.25, 1.05); ctx.lineTo(64, 64); ctx.fill();
  ctx.beginPath(); ctx.arc(64, 64, 62, Math.PI - 0.25, Math.PI + 1.05); ctx.lineTo(64, 64); ctx.fill();
  // Smiley
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(42, 50, 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(82, 50, 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(62, 72, 18, 0.1, Math.PI - 0.1); ctx.stroke();

  const ball = _m(
    new THREE.SphereGeometry(0.16, 14, 10),
    new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) })
  );
  ball.position.y = 0.17;
  g.add(ball);
  g.userData.ball = ball;   // Referenz für Animation (nur Ball rotieren, nicht die ganze Gruppe)
  return g;
}

// ─────────────────────────────────────────────────────────────
// 3 – Baby
// ─────────────────────────────────────────────────────────────
function _makeBaby() {
  const g = new THREE.Group();
  const skin   = _lm(0xffce9e);
  const white  = _lm(0xffffff);
  const blonde = _lm(0xffd700);
  const red    = _lm(0xff5555);

  // Windel
  g.add(_pos(_m(new THREE.BoxGeometry(0.14, 0.09, 0.11), white), 0, 0.065, 0));
  // Körper
  g.add(_pos(_m(new THREE.CapsuleGeometry(0.08, 0.08, 4, 8), skin), 0, 0.20, 0));
  // Kopf (groß – Babyproportion)
  g.add(_pos(_m(new THREE.SphereGeometry(0.11, 10, 8), skin), 0, 0.40, 0));
  // Haare
  const hair = _m(new THREE.SphereGeometry(0.085, 8, 5), blonde);
  hair.scale.set(1, 0.4, 1);
  g.add(_pos(hair, 0, 0.505, 0));
  // Augen
  [-0.045, 0.045].forEach(x => g.add(_pos(_m(new THREE.SphereGeometry(0.016, 6, 6), _lm(0x333333)), x, 0.42, 0.10)));
  // Mund
  const mouth = _m(new THREE.SphereGeometry(0.018, 6, 4), red);
  mouth.scale.set(1.5, 0.6, 0.5);
  g.add(_pos(mouth, 0, 0.375, 0.108));

  // Arme (animiert)
  ['l', 'r'].forEach(side => {
    const arm = new THREE.Group();
    arm.position.set(side === 'l' ? -0.09 : 0.09, 0.22, 0);
    arm.rotation.z = side === 'l' ? 0.4 : -0.4;
    const am = _m(new THREE.CapsuleGeometry(0.028, 0.07, 4, 6), skin);
    am.position.y = -0.04;
    arm.add(am);
    g.add(arm);
    g.userData[side + 'Arm'] = arm;
  });

  return g;
}

// ─────────────────────────────────────────────────────────────
// 4 – Simba (Löwe)
// ─────────────────────────────────────────────────────────────
function _makeSimba() {
  const g = new THREE.Group();
  const tan   = _lm(0xe8a838);
  const brown = _lm(0x7a4a10);
  const pink  = _lm(0xff9999);
  const green = _lm(0x44aa44);

  // Körper + Kopf
  g.add(_pos(_m(new THREE.CapsuleGeometry(0.10, 0.12, 4, 8), tan), 0, 0.16, 0));
  g.add(_pos(_m(new THREE.SphereGeometry(0.11, 10, 8), tan), 0, 0.40, 0));

  // Mähne (8 Kegel im Ring)
  for (let i = 0; i < 8; i++) {
    const a  = (i / 8) * Math.PI * 2;
    const mn = _m(new THREE.ConeGeometry(0.045, 0.10, 5), brown);
    mn.position.set(Math.cos(a) * 0.11, 0.40 + Math.sin(a) * 0.10, 0);
    mn.rotation.z = a + Math.PI / 2;
    g.add(mn);
  }

  // Ohren
  [-0.10, 0.10].forEach(x => g.add(_pos(_m(new THREE.ConeGeometry(0.04, 0.06, 5), tan), x, 0.505, 0)));
  // Augen
  [-0.04, 0.04].forEach(x => g.add(_pos(_m(new THREE.SphereGeometry(0.018, 6, 6), green), x, 0.42, 0.10)));
  // Nase
  g.add(_pos(_m(new THREE.SphereGeometry(0.025, 6, 4), pink), 0, 0.39, 0.112));

  // Schweif (animiert)
  const tail = new THREE.Group();
  tail.position.set(0.08, 0.18, -0.09);
  const tm = _m(new THREE.CapsuleGeometry(0.018, 0.14, 4, 6), tan);
  tm.rotation.x = 0.5; tm.position.y = 0.06;
  tail.add(tm);
  tail.add(_pos(_m(new THREE.SphereGeometry(0.035, 6, 4), brown), 0, 0.16, 0.08));
  g.add(tail);
  g.userData.tail = tail;

  return g;
}

// ─────────────────────────────────────────────────────────────
// 5 – Karl (PKW)
// ─────────────────────────────────────────────────────────────
function _makeKarl() {
  const g = new THREE.Group();
  const red    = _lm(0xe74c3c);
  const black  = _lm(0x111111);
  const yellow = _lm(0xffee00);
  const grey   = _lm(0x777777);

  // Karosserie
  g.add(_pos(_m(new THREE.BoxGeometry(0.32, 0.09, 0.20), red), 0, 0.09, 0));
  // Fahrgastzelle
  g.add(_pos(_m(new THREE.BoxGeometry(0.22, 0.10, 0.17), red), 0, 0.195, 0));

  // Fenster (leicht helleres Blau)
  const winM = new THREE.MeshLambertMaterial({ color: 0x88ddff, transparent: true, opacity: 0.75 });
  g.add(_pos(_m(new THREE.BoxGeometry(0.16, 0.065, 0.008), winM), 0, 0.205, -0.089));
  g.add(_pos(_m(new THREE.BoxGeometry(0.16, 0.065, 0.008), winM), 0, 0.205,  0.089));

  // 4 Räder + Nabenkappen
  const wheels = [];
  [[-0.155, -0.082], [-0.155, 0.082], [0.155, -0.082], [0.155, 0.082]].forEach(([x, z]) => {
    const w = _m(new THREE.CylinderGeometry(0.065, 0.065, 0.045, 10), black);
    w.rotation.z = Math.PI / 2;
    g.add(_pos(w, x, 0.07, z));
    const hub = _m(new THREE.CylinderGeometry(0.030, 0.030, 0.047, 6), grey);
    hub.rotation.z = Math.PI / 2;
    g.add(_pos(hub, x, 0.07, z));
    wheels.push(w);
  });
  g.userData.wheels = wheels;

  // Scheinwerfer
  [-0.085, 0.085].forEach(x => g.add(_pos(_m(new THREE.SphereGeometry(0.025, 6, 4), yellow), x, 0.10, -0.105)));

  return g;
}

// ─────────────────────────────────────────────────────────────
// 6 – Wikinger (Helm)
// ─────────────────────────────────────────────────────────────
function _makeWikinger() {
  const g = new THREE.Group();
  const metal = _lm(0x8899aa);
  const dark  = _lm(0x445566);
  const bone  = _lm(0xeeddcc);

  // Helmkuppel (halbe Kugel)
  const dome = _m(
    new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
    metal
  );
  dome.position.y = 0.14;
  g.add(dome);
  g.userData.dome = dome;

  // Rand
  const rim = _m(new THREE.TorusGeometry(0.135, 0.014, 6, 20), dark);
  rim.position.y = 0.14;
  g.add(rim);

  // Hörner
  [[-0.13, Math.PI / 6], [0.13, -Math.PI / 6]].forEach(([x, rz]) => {
    const horn = _m(new THREE.ConeGeometry(0.036, 0.20, 6), bone);
    horn.position.set(x, 0.235, 0);
    horn.rotation.z = rz;
    g.add(horn);
  });

  // Nasenschutz
  g.add(_pos(_m(new THREE.BoxGeometry(0.040, 0.13, 0.038), metal), 0, 0.08, 0.132));

  // Wangenschützer
  [-0.13, 0.13].forEach(x => g.add(_pos(_m(new THREE.BoxGeometry(0.07, 0.08, 0.030), metal), x, 0.065, 0.04)));

  // Augen (sichtbar unter Helm)
  [-0.045, 0.045].forEach(x => g.add(_pos(_m(new THREE.SphereGeometry(0.018, 6, 6), _lm(0x226622)), x, 0.14, 0.118)));

  return g;
}

// ─────────────────────────────────────────────────────────────
// 7 – Elli (Elefant)
// ─────────────────────────────────────────────────────────────
function _makeElli() {
  const g = new THREE.Group();
  const grey  = _lm(0x9999bb);
  const lgrey = _lm(0xbbbbdd);
  const ivory = _lm(0xfffacd);
  const black = _lm(0x222222);

  // Körper
  const body = _m(new THREE.SphereGeometry(0.14, 10, 8), grey);
  body.scale.set(1, 0.88, 1.05);
  g.add(_pos(body, 0, 0.16, 0));

  // Kopf
  g.add(_pos(_m(new THREE.SphereGeometry(0.10, 10, 8), grey), 0, 0.37, 0));

  // Ohren
  [-0.14, 0.14].forEach(x => {
    const ear = _m(new THREE.SphereGeometry(0.09, 8, 6), lgrey);
    ear.scale.set(0.35, 1.0, 0.9);
    g.add(_pos(ear, x, 0.37, -0.01));
  });

  // Rüssel (3 Kugeln)
  [[0, 0.30, 0.085], [0, 0.252, 0.128], [0, 0.21, 0.163]].forEach(([x, y, z], i) => {
    const seg = _m(new THREE.SphereGeometry(0.038 - i * 0.006, 6, 5), grey);
    g.add(_pos(seg, x, y, z));
  });

  // Stoßzähne
  [-0.04, 0.04].forEach(x => {
    const tusk = _m(new THREE.ConeGeometry(0.014, 0.09, 5), ivory);
    tusk.rotation.x = -0.7;
    g.add(_pos(tusk, x, 0.31, 0.093));
  });

  // Beine
  [[-0.08, -0.08], [-0.08, 0.06], [0.08, -0.08], [0.08, 0.06]].forEach(([x, z]) =>
    g.add(_pos(_m(new THREE.CapsuleGeometry(0.04, 0.07, 4, 6), grey), x, 0.07, z)));

  // Augen
  [-0.045, 0.045].forEach(x => g.add(_pos(_m(new THREE.SphereGeometry(0.016, 6, 6), black), x, 0.40, 0.092)));

  return g;
}

// ─────────────────────────────────────────────────────────────
// 8 – Bello (Hund)
// ─────────────────────────────────────────────────────────────
function _makeBello() {
  const g = new THREE.Group();
  const tan   = _lm(0xcc9955);
  const dtan  = _lm(0xaa7733);
  const black = _lm(0x222222);
  const pink  = _lm(0xff9999);

  // Körper + Kopf
  g.add(_pos(_m(new THREE.CapsuleGeometry(0.09, 0.11, 4, 8), tan), 0, 0.16, 0));
  g.add(_pos(_m(new THREE.SphereGeometry(0.09, 10, 8), tan), 0, 0.35, 0));

  // Schnauze
  const snout = _m(new THREE.SphereGeometry(0.055, 8, 6), tan);
  snout.scale.set(0.9, 0.70, 0.75);
  g.add(_pos(snout, 0, 0.33, 0.082));

  // Nase + Zunge
  g.add(_pos(_m(new THREE.SphereGeometry(0.022, 6, 4), black), 0, 0.35, 0.137));
  const tongue = _m(new THREE.SphereGeometry(0.025, 6, 4), pink);
  tongue.scale.set(1, 0.5, 0.7);
  g.add(_pos(tongue, 0, 0.302, 0.137));

  // Ohren (hängend)
  [-0.09, 0.09].forEach(x => {
    const ear = _m(new THREE.SphereGeometry(0.065, 8, 5), dtan);
    ear.scale.set(0.5, 1.1, 0.4);
    g.add(_pos(ear, x, 0.33, -0.01));
  });

  // Augen
  [-0.04, 0.04].forEach(x => g.add(_pos(_m(new THREE.SphereGeometry(0.016, 6, 6), black), x, 0.37, 0.083)));

  // Schweif (animiert)
  const tail = new THREE.Group();
  tail.position.set(0.055, 0.24, -0.09);
  const tm = _m(new THREE.CapsuleGeometry(0.020, 0.09, 4, 6), tan);
  tm.rotation.x = -0.6; tm.position.y = 0.04;
  tail.add(tm);
  g.add(tail);
  g.userData.tail = tail;

  // Beine
  [[-0.07, -0.07], [-0.07, 0.06], [0.07, -0.07], [0.07, 0.06]].forEach(([x, z]) =>
    g.add(_pos(_m(new THREE.CapsuleGeometry(0.030, 0.06, 4, 6), tan), x, 0.06, z)));

  return g;
}

// ─────────────────────────────────────────────────────────────
// 9 – Mathebuch
// ─────────────────────────────────────────────────────────────
function _makeMathebuch() {
  const g = new THREE.Group();

  // Deckeltextur
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a3a99';
  ctx.fillRect(0, 0, 128, 160);
  ctx.strokeStyle = '#ffdd00'; ctx.lineWidth = 7;
  ctx.strokeRect(7, 7, 114, 146);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('+', 40, 55);
  ctx.fillText('−', 88, 55);
  ctx.fillText('×', 40, 115);
  ctx.fillText('÷', 88, 115);

  const coverMat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) });

  // Buchdeckel
  const book = _m(new THREE.BoxGeometry(0.18, 0.24, 0.04), coverMat);
  book.position.set(0, 0.18, 0); book.rotation.y = 0.15;
  g.add(book);

  // Buchrücken
  g.add(_pos(_m(new THREE.BoxGeometry(0.04, 0.24, 0.04), _lm(0x112288)), -0.107, 0.18, 0));

  // Seiten (Schnitt)
  g.add(_pos(_m(new THREE.BoxGeometry(0.175, 0.232, 0.034), _lm(0xfff8ee)), 0.004, 0.18, 0.038));

  return g;
}

// ─────────────────────────────────────────────────────────────
// 10 – Minime (Mini-Avatar, trägt die T-Shirt-Farbe des Besitzers)
// ─────────────────────────────────────────────────────────────
function _makeMinime(shirtColor = '#5b9bd5', skinColor = '#ffce9e') {
  const g = new THREE.Group();
  const parts = createAvatarMesh(null, shirtColor, skinColor);
  parts.group.scale.setScalar(0.22);
  g.add(parts.group);
  return g;
}
