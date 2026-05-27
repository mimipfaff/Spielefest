import * as THREE from 'three';

const MOVE_SPEED      = 0.15;   // Einheiten pro Frame
const BOUNDARY_RADIUS = 34;     // Kreisförmige Weltgrenze: hinter dem Kiesweg-Ring (31–32.8), vor den Bergen (ab 38)
const AVATAR_RADIUS   = 1.1;    // Mindest-Abstand zwischen Avatar-Mittelpunkten (Körper + Glied-Spielraum)

// ─────────────────────────────────────────────────────────────
// BotW-Stil Orbit-Kamera
// ─────────────────────────────────────────────────────────────
export class CameraController {
  constructor(camera) {
    this.camera = camera;

    this.theta = Math.PI;          // Horizontalwinkel (Start: hinter dem Spieler)
    this.phi   = 0.42;             // Vertikalwinkel   (leicht von oben)
    this.minPhi = 0.08;
    this.maxPhi = Math.PI / 2 - 0.04;

    this.distance = 8;
    this.minDist  = 3;
    this.maxDist  = 20;

    this.target = new THREE.Vector3();   // wohin die Kamera schaut (geglättet)

    this._dragging = false;
    this._prevX    = 0;
    this._prevY    = 0;

    this._enabled    = true;   // kann von aussen deaktiviert werden (z.B. im Editor)

    /** Wenn true: Kamera folgt dem Avatar automatisch von hinten */
    this.followMode = false;

    /**
     * Wird aufgerufen wenn der Nutzer die Kamera manuell dreht und
     * followMode dabei deaktiviert wird (damit der Button-Zustand aktualisiert wird).
     * @type {(() => void) | null}
     */
    this.onManualControl = null;

    this._bindEvents();
  }

  // ── Maus & Touch ───────────────────────────────────────────
  _bindEvents() {
    const onDown = (x, y, target) => {
      if (!this._enabled) return;
      // HUD-Elemente nicht versehentlich als Drag-Start behandeln
      if (target && (target.closest('#hud') || target.closest('#createBtn'))) return;
      this._dragging = true;
      this._prevX = x;
      this._prevY = y;
    };
    const onMove = (x, y) => {
      if (!this._dragging || !this._enabled) return;
      const dx = x - this._prevX;
      const dy = y - this._prevY;
      // Manuelle Kamerabewegung deaktiviert Follow-Modus
      if (this.followMode && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        this.followMode = false;
        if (this.onManualControl) this.onManualControl();
      }
      this.theta -= dx * 0.007;
      this.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.phi - dy * 0.007));
      this._prevX = x;
      this._prevY = y;
    };
    const onUp = () => { this._dragging = false; };

    // Maus
    document.addEventListener('mousedown',  e => {
      if (e.target.closest('#btnCamCenter')) return;
      onDown(e.clientX, e.clientY, e.target);
    });
    document.addEventListener('mousemove',  e => onMove(e.clientX, e.clientY));
    document.addEventListener('mouseup',    onUp);
    document.addEventListener('mouseleave', onUp);

    // Touch (mobil) – Joystick/HUD-Elemente als Drag-Quelle ausschließen
    document.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        const tgt = e.target;
        if (tgt.closest('.joy-base') || tgt.closest('.zoom-btns') ||
            tgt.closest('#btnCamCenter') ||
            tgt.closest('#hud')      || tgt.closest('#createBtn')) return;
        onDown(e.touches[0].clientX, e.touches[0].clientY, tgt);
      }
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (e.touches.length === 1)
        onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchend', onUp);

    // Scroll = Zoom
    document.addEventListener('wheel', e => {
      this.distance = Math.max(this.minDist,
        Math.min(this.maxDist, this.distance + e.deltaY * 0.012));
    }, { passive: true });

    // Kein Kontextmenue bei Rechtsklick
    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── Pro-Frame-Update ───────────────────────────────────────
  /**
   * @param {THREE.Vector3} playerPos
   * @param {import('./joystick.js').VirtualJoystick|null} joystickR  – rechter Joystick (Kamera)
   * @param {import('./joystick.js').ZoomButtons|null}     zoomBtns   – Zoom-Buttons
   * @param {number|null}                                  playerRotY – Y-Rotation des Avatars (für Follow-Mode)
   */
  update(playerPos, joystickR = null, zoomBtns = null, playerRotY = null) {
    // ── Follow-Modus: Kamera dreht sich mit dem Avatar mit ────
    if (this.followMode && playerRotY !== null) {
      // Kamera soll von hinten schauen: theta = avatarRotY + π
      const targetTheta = playerRotY + Math.PI;
      let d = targetTheta - this.theta;
      // Kürzesten Winkelweg wählen
      while (d >  Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.theta += d * 0.10;
    }

    // Rechter Joystick → Kamera-Winkel (überschreibt Follow-Modus temporär)
    if (joystickR && joystickR.active && joystickR.mag > 0.08) {
      if (this.followMode) {
        this.followMode = false;
        if (this.onManualControl) this.onManualControl();
      }
      this.theta -= joystickR.dx * 0.040;
      this.phi    = Math.max(this.minPhi,
        Math.min(this.maxPhi, this.phi - joystickR.dy * 0.028));
    }

    // Zoom-Buttons
    if (zoomBtns && zoomBtns.delta !== 0) {
      this.distance = Math.max(this.minDist,
        Math.min(this.maxDist, this.distance + zoomBtns.delta * 0.14));
    }

    // Sanft dem Spieler folgen (leichtes Smoothing)
    const lookAt = playerPos.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.target.lerp(lookAt, 0.10);

    const sinT = Math.sin(this.theta);
    const cosT = Math.cos(this.theta);
    const cosP = Math.cos(this.phi);
    const sinP = Math.sin(this.phi);

    this.camera.position.set(
      this.target.x + this.distance * sinT * cosP,
      this.target.y + this.distance * sinP,
      this.target.z + this.distance * cosT * cosP
    );
    this.camera.lookAt(this.target);
  }

  // Vorwaerts-Richtung der Kamera (projiziert auf XZ-Ebene)
  getForward() {
    return new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
  }

  // Rechts-Richtung der Kamera
  getRight() {
    return new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
  }

  setEnabled(v) { this._enabled = v; }
}

// ─────────────────────────────────────────────────────────────
// Lokaler Spieler – Eingabe, Bewegung, AC-Animation
// ─────────────────────────────────────────────────────────────
export class LocalPlayer {
  /**
   * @param {{ group, lArmPivot, rArmPivot, lLegPivot, rLegPivot, body, head }} avatarParts
   */
  constructor(avatarParts) {
    this.mesh      = avatarParts.group;
    this.lArmPivot = avatarParts.lArmPivot;
    this.rArmPivot = avatarParts.rArmPivot;
    this.lLegPivot = avatarParts.lLegPivot;
    this.rLegPivot = avatarParts.rLegPivot;
    this.body      = avatarParts.body;
    this.head      = avatarParts.head;

    this.position    = new THREE.Vector3(0, 0, 0);
    this._targetRotY = 0;
    this._bobY       = 0;      // vertikaler Hüpf-Offset
    this._keys       = {};

    this._bindKeys();
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.mesh.position.set(x, y, z);
  }

  // ── Tastatur ───────────────────────────────────────────────
  _bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this._keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', e => {
      this._keys[e.key.toLowerCase()] = false;
    });
  }

  // ── Hilfsmethode: irgendeine Bewegungstaste gedrückt? ──────
  _anyKeyActive() {
    const k = this._keys;
    return k['w'] || k['s'] || k['a'] || k['d'] ||
           k['arrowup'] || k['arrowdown'] || k['arrowleft'] || k['arrowright'];
  }

  // ── Update (einmal pro Frame) ──────────────────────────────
  /**
   * @param cam – CameraController
   * @param {Array} obstacles – Positionen anderer Avatare
   * @param {import('./joystick.js').VirtualJoystick|null} joystickL – linker Joystick (Bewegung)
   */
  update(cam, obstacles = [], joystickL = null) {
    const forward = cam.getForward();
    const right   = cam.getRight();
    const dir     = new THREE.Vector3();

    if (this._keys['w'] || this._keys['arrowup'])    dir.addScaledVector(forward,  1);
    if (this._keys['s'] || this._keys['arrowdown'])  dir.addScaledVector(forward, -1);
    if (this._keys['a'] || this._keys['arrowleft'])  dir.addScaledVector(right,   -1);
    if (this._keys['d'] || this._keys['arrowright']) dir.addScaledVector(right,    1);

    // ── Linker Joystick (Touch) ────────────────────────────────
    let joyMag = 0;
    if (joystickL && joystickL.active && joystickL.mag > 0.08) {
      joyMag = joystickL.mag;
      // dy: Finger nach oben = negatives dy = nach vorne laufen
      dir.addScaledVector(forward, -joystickL.dy);
      dir.addScaledVector(right,    joystickL.dx);
    }

    const moving = dir.lengthSq() > 0;

    if (moving) {
      dir.normalize();
      this._targetRotY = Math.atan2(dir.x, dir.z);

      // Proportionale Geschwindigkeit bei reiner Joystick-Eingabe
      const speed = (joystickL?.active && !this._anyKeyActive())
        ? MOVE_SPEED * Math.max(0.28, joyMag)
        : MOVE_SPEED;
      this.position.addScaledVector(dir, speed);

      // ── Kollision mit anderen Avataren – harte Grenze ──────
      for (const obs of obstacles) {
        const dx     = this.position.x - obs.x;
        const dz     = this.position.z - obs.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < AVATAR_RADIUS * AVATAR_RADIUS && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          // Spieler exakt auf die Grenze zurückschieben
          this.position.x = obs.x + (dx / dist) * AVATAR_RADIUS;
          this.position.z = obs.z + (dz / dist) * AVATAR_RADIUS;
        }
      }

      // ── Kreisförmige Weltgrenze – hinter dem Kiesweg-Ring ──
      const _d = Math.sqrt(this.position.x * this.position.x + this.position.z * this.position.z);
      if (_d > BOUNDARY_RADIUS) {
        const _s = BOUNDARY_RADIUS / _d;
        this.position.x *= _s;
        this.position.z *= _s;
      }
    }

    // Rotation sanft angleichen
    let dRot = this._targetRotY - this.mesh.rotation.y;
    while (dRot >  Math.PI) dRot -= Math.PI * 2;
    while (dRot < -Math.PI) dRot += Math.PI * 2;
    this.mesh.rotation.y += dRot * 0.13;

    // Position setzen (mit Hüpf-Offset)
    this.position.y = 0;
    this.mesh.position.set(
      this.position.x,
      this.position.y + this._bobY,
      this.position.z
    );

    this._animate(moving);
    return moving;
  }

  // ── Animal-Crossing-Animation ──────────────────────────────
  _animate(moving) {
    const now = Date.now();

    if (moving) {
      // Schritt-Zyklus: etwas langsamer und wackeliger als realistisch
      const t     = now * 0.0058;
      const cycle = Math.sin(t);          // -1 … +1
      const abs   = Math.abs(cycle);      //  0 … +1

      // Arme schwingen – auch leicht nach außen (z-Achse)
      this.lArmPivot.rotation.x =  cycle * 0.65;
      this.rArmPivot.rotation.x = -cycle * 0.65;
      this.lArmPivot.rotation.z = -abs   * 0.18;   // Arme gehen beim Schritt leicht raus
      this.rArmPivot.rotation.z =  abs   * 0.18;

      // Beine schwingen
      this.lLegPivot.rotation.x = -cycle * 0.55;
      this.rLegPivot.rotation.x =  cycle * 0.55;

      // Hüpf-Bob: Körper hebt sich leicht bei jedem Schritt
      this._bobY = abs * 0.10;

      // Körper lehnt minimal in Laufrichtung
      this.mesh.rotation.x = 0.055;

      // Squash & Stretch: Körper staucht sich beim Aufprall, streckt sich oben
      if (this.body) {
        this.body.scale.y = 1.0 + (1 - abs) * 0.06;   // staucht wenn Boden berührt
        this.body.scale.x = 1.0 - (1 - abs) * 0.03;
      }
      // Kopf wippt leicht entgegen dem Körper
      if (this.head) {
        this.head.position.y = 2.56 - abs * 0.04;
      }

    } else {
      // ── Idle: sanft in Ruhe übergehen ─────────────────────
      this.lArmPivot.rotation.x *= 0.78;
      this.rArmPivot.rotation.x *= 0.78;
      this.lArmPivot.rotation.z *= 0.78;
      this.rArmPivot.rotation.z *= 0.78;
      this.lLegPivot.rotation.x *= 0.78;
      this.rLegPivot.rotation.x *= 0.78;
      this.mesh.rotation.x      *= 0.78;
      this._bobY                 *= 0.78;

      // Atmen: Körper hebt und senkt sich ganz sanft
      if (this.body) {
        const breath = Math.sin(now * 0.0013) * 0.018;
        this.body.scale.y = 1.0 + breath;
        this.body.scale.x = 1.0 - breath * 0.4;
      }
      // Kopf kehrt zur Startposition zurück
      if (this.head) {
        this.head.position.y += (2.56 - this.head.position.y) * 0.12;
      }
    }
  }
}
