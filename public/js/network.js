import * as THREE from 'three';
import { createAvatarMesh, createNameTag } from './avatar.js';

// LOD-Schwellwerte (in Welt-Einheiten Abstand zur Kamera)
const LOD_FULL = 28;   // unter dieser Distanz: volle Animation
const LOD_HIDE = 65;   // über dieser Distanz: Gruppe unsichtbar

// ─────────────────────────────────────────────────────────────
export class NetworkManager {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene          = scene;
    this.socket         = null;
    this.selfId         = null;

    /** Map<socketId, { group, nameTag }> */
    this.remotePlayers  = new Map();

    /** Callback({ boothId, counts }) */
    this.onBoothCounts    = null;
    /** Callback({ boothId, players }) */
    this.onMinigameStarted = null;
    /** Callback(msg: string) */
    this.onMinigameError   = null;
    /** Callback(faceData: string) – lokaler Spieler hat neues Gesicht */
    this.onPlayerFaceUpdate = null;
    /** Callback(socketId, petId, petOwners) */
    this.onPetAdopted  = null;
    /** Callback(socketId, petId, petOwners) */
    this.onPetReturned = null;
  }

  // ── Verbinden ──────────────────────────────────────────────
  /**
   * @param {{ name, faceData }} playerData
   * @param {(selfData: { selfId, spawnX, spawnZ }) => void} onReady
   */
  connect(playerData, onReady) {
    this.socket = io();

    // Server voll
    this.socket.on('serverFull', () => {
      alert('Die Welt ist voll! Maximal 30 Spieler erlaubt.');
    });

    // Initialer Spielstand nach erfolgreichem Beitritt
    this.socket.on('init', (data) => {
      this.selfId = data.selfId;

      // Bestehende Spieler einblenden
      Object.values(data.players).forEach(p => {
        if (p.id !== this.selfId) this._spawn(p);
      });

      // Bestehende Welt-Objekte laden
      if (this.onObjectAdded) {
        (data.worldObjs || []).forEach(obj => this.onObjectAdded(obj));
      }

      // Eigene Spawn-Position aus Server-Daten
      const self = data.players[data.selfId] || {};
      onReady({
        selfId: data.selfId,
        spawnX: self.x || 0,
        spawnZ: self.z || 0
      });

      // Bestehende Haustiere spawnen
      if (data.petOwners) {
        Object.entries(data.petOwners).forEach(([petId, ownerId]) => {
          if (ownerId && this.onPetAdopted) this.onPetAdopted(ownerId, petId, data.petOwners);
        });
      }

      this._updateCount();
    });

    // Neuer Spieler kommt
    this.socket.on('playerJoined', p => {
      this._spawn(p);
      this._updateCount();
    });

    // Spieler geht
    this.socket.on('playerLeft', id => {
      this._despawn(id);
      this._updateCount();
    });

    // Spieler bewegt sich
    this.socket.on('playerMoved', ({ id, x, y, z, rotY }) => {
      const p = this.remotePlayers.get(id);
      if (!p) return;
      // Sanftes Smoothing fuer Fremdspieler
      p.targetPos  = { x, y, z };
      p.targetRotY = rotY;
    });

    // Booth-Zaehler aktualisiert
    this.socket.on('boothCounts', counts => {
      if (this.onBoothCounts) this.onBoothCounts(counts);
    });

    // Minigame gestartet (Phase 3)
    this.socket.on('minigameStarted', data => {
      console.log('[Minigame] minigameStarted empfangen:', data.gameType);
      if (this.onMinigameStarted) this.onMinigameStarted(data);
    });

    // Server kann Minigame nicht starten (zu wenig Spieler etc.)
    this.socket.on('minigameError', ({ msg }) => {
      console.warn('[Minigame] Fehler:', msg);
      if (this.onMinigameError) this.onMinigameError(msg);
    });

    // Gesicht eines Spielers hat sich geändert (nach Facepaint)
    this.socket.on('playerFaceUpdate', ({ id, faceData }) => {
      const p = this.remotePlayers.get(id);
      if (p && p.faceDisc) _applyFaceToDisc(p.faceDisc, faceData);
      if (id === this.selfId && this.onPlayerFaceUpdate) this.onPlayerFaceUpdate(faceData);
    });

    // Haustier adoptiert
    this.socket.on('petAdopted', ({ socketId, petId, petOwners }) => {
      if (this.onPetAdopted) this.onPetAdopted(socketId, petId, petOwners);
    });

    // Haustier zurückgegeben
    this.socket.on('petReturned', ({ socketId, petId, petOwners }) => {
      if (this.onPetReturned) this.onPetReturned(socketId, petId, petOwners);
    });

    // Fehler beim Adoptieren
    this.socket.on('petError', msg => {
      console.warn('[Pet]', msg);
    });

    // Beitreten
    this.socket.emit('join', playerData);
  }

  // ── Eigene Position senden ─────────────────────────────────
  sendMove(x, y, z, rotY) {
    if (this.socket) this.socket.emit('move', { x, y, z, rotY });
  }

  sendNearBooth(boothId) {
    if (this.socket) this.socket.emit('nearBooth', boothId);
  }

  sendLeftBooth() {
    if (this.socket) this.socket.emit('leftBooth');
  }

  sendStartMinigame(boothId) {
    if (this.socket) this.socket.emit('startMinigame', boothId);
  }

  sendAdoptPet(petId) {
    if (this.socket) this.socket.emit('adoptPet', petId);
  }

  sendReturnPet() {
    if (this.socket) this.socket.emit('returnPet');
  }

  // ── Fremd-Avatare pro Frame updaten ───────────────────────
  /**
   * Interpoliert Positionen und richtet Name-Tags zur Kamera aus.
   * LOD: Volle Animation nur unter LOD_FULL; unsichtbar über LOD_HIDE.
   * @param {THREE.Camera} camera
   */
  updateRemotePlayers(camera) {
    const now    = Date.now();
    const camPos = camera.position;
    this.remotePlayers.forEach(p => {
      // Distanz zur Kamera (XZ reicht für LOD-Entscheidung)
      const dx   = p.group.position.x - camPos.x;
      const dz   = p.group.position.z - camPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Sichtbarkeit: jenseits LOD_HIDE gar nicht rendern
      const visible = dist < LOD_HIDE;
      if (p.group.visible !== visible) p.group.visible = visible;
      if (!visible) return;

      // Position interpolieren
      if (p.targetPos) {
        const tp = new THREE.Vector3(p.targetPos.x, p.targetPos.y, p.targetPos.z);
        p.group.position.lerp(tp, 0.12);
      }
      // Rotation
      if (p.targetRotY !== undefined) {
        let d = p.targetRotY - p.group.rotation.y;
        while (d >  Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.group.rotation.y += d * 0.12;
      }

      // Name-Tag zur Kamera
      if (p.nameTag) p.nameTag.lookAt(camPos);

      // Animation nur im Nahbereich (LOD_FULL)
      if (dist > LOD_FULL) return;

      // Bewegung erkennen (Distanz zum letzten Frame)
      const ddx    = p.group.position.x - (p.prevPos?.x || 0);
      const ddz    = p.group.position.z - (p.prevPos?.z || 0);
      const moving = (ddx * ddx + ddz * ddz) > 0.000001;
      if (p.prevPos) { p.prevPos.x = p.group.position.x; p.prevPos.z = p.group.position.z; }

      // Animation (vereinfachte Version der lokalen AC-Animation)
      if (moving) {
        const t     = now * 0.0058;
        const cycle = Math.sin(t);
        const abs   = Math.abs(cycle);
        if (p.lArmPivot) { p.lArmPivot.rotation.x =  cycle * 0.65; p.lArmPivot.rotation.z = -abs * 0.18; }
        if (p.rArmPivot) { p.rArmPivot.rotation.x = -cycle * 0.65; p.rArmPivot.rotation.z =  abs * 0.18; }
        if (p.lLegPivot)  p.lLegPivot.rotation.x = -cycle * 0.55;
        if (p.rLegPivot)  p.rLegPivot.rotation.x =  cycle * 0.55;
        p.group.position.y = (p.targetPos?.y || 0) + abs * 0.10;
        if (p.body) { p.body.scale.y = 1 + (1 - abs) * 0.06; p.body.scale.x = 1 - (1 - abs) * 0.03; }
      } else {
        if (p.lArmPivot) { p.lArmPivot.rotation.x *= 0.78; p.lArmPivot.rotation.z *= 0.78; }
        if (p.rArmPivot) { p.rArmPivot.rotation.x *= 0.78; p.rArmPivot.rotation.z *= 0.78; }
        if (p.lLegPivot)  p.lLegPivot.rotation.x *= 0.78;
        if (p.rLegPivot)  p.rLegPivot.rotation.x *= 0.78;
        if (p.body) {
          const breath = Math.sin(now * 0.0013 + p.group.id) * 0.018;
          p.body.scale.y = 1 + breath;
          p.body.scale.x = 1 - breath * 0.4;
        }
      }
    });
  }

  // ── Intern ─────────────────────────────────────────────────
  _spawn(data) {
    const parts = createAvatarMesh(
      data.faceData, data.shirtColor, data.skinColor,
      data.hairStyle || 'none', data.hairColor || '#1a0a05'
    );
    const group = parts.group;
    group.position.set(data.x || 0, data.y || 0, data.z || 0);
    group.rotation.y = data.rotY || 0;

    // Schatten bei Fremd-Avataren deaktivieren – halbiert Shadow-Map-Draw-Calls
    group.traverse(child => { if (child.isMesh) { child.castShadow = false; child.receiveShadow = false; } });

    const nameTag = createNameTag(data.name || 'Spieler');
    nameTag.position.y = 3.55;
    group.add(nameTag);

    this.scene.add(group);
    this.remotePlayers.set(data.id, {
      group,
      nameTag,
      body:       parts.body,
      head:       parts.head,
      faceDisc:   parts.faceDisc,
      lArmPivot:  parts.lArmPivot,
      rArmPivot:  parts.rArmPivot,
      lLegPivot:  parts.lLegPivot,
      rLegPivot:  parts.rLegPivot,
      shirtColor: data.shirtColor || '#5b9bd5',
      skinColor:  data.skinColor  || '#ffce9e',
      targetPos:  { x: data.x || 0, y: 0, z: data.z || 0 },
      targetRotY: data.rotY || 0,
      prevPos:    { x: data.x || 0, z: data.z || 0 }
    });
  }

  _despawn(id) {
    const p = this.remotePlayers.get(id);
    if (!p) return;
    this.scene.remove(p.group);
    p.group.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => m.dispose());
      }
    });
    this.remotePlayers.delete(id);
  }

  _updateCount() {
    const total = this.remotePlayers.size + 1;
    const el    = document.getElementById('playerCount');
    if (el) el.textContent = `\u{1F465} ${total}`;
  }
}

// ── Gesicht auf einen faceDisc anwenden ──────────────────────
export function _applyFaceToDisc(faceDisc, faceData) {
  if (!faceDisc) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.getContext('2d').drawImage(img, 0, 0, 256, 256);
    if (faceDisc.material.map) faceDisc.material.map.dispose();
    const newTex = new THREE.CanvasTexture(c);
    newTex.colorSpace = THREE.SRGBColorSpace;   // konsistente Farbdarstellung wie im Login-Canvas
    faceDisc.material.map   = newTex;
    faceDisc.material.color.set(0xffffff);   // Farbe neutralisieren damit Textur sichtbar ist
    faceDisc.material.needsUpdate = true;
  };
  img.src = faceData;
}
