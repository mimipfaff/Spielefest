import * as THREE from 'three';
import { createAvatarMesh, createNameTag } from '../avatar.js';

// ─────────────────────────────────────────────────────────────
// Koordinaten: Server 0–10 (Zentrum 5,5) → Three.js X/Z
// ─────────────────────────────────────────────────────────────
const SCALE   = 1.4;
const ANIM_MS = 240;               // Dauer Kick/Slap-Animation (≈ doppelte Geschwindigkeit)
const sw = v => (v - 5) * SCALE;  // server-Wert → Three.js-Achse

// ─────────────────────────────────────────────────────────────
export class KickSlapGame {

  /**
   * @param {string} selfId
   * @param {object} data
   * @param {import('socket.io-client').Socket} socket
   * @param {import('../joystick.js').VirtualJoystick|null} joyLeft  – linker Joystick (Bewegen + Tap = SLAP)
   * @param {import('../joystick.js').VirtualJoystick|null} joyRight – rechter Joystick (Tap = KICK)
   */
  constructor(selfId, data, socket, joyLeft = null, joyRight = null) {
    this.selfId      = selfId;
    this.socket      = socket;
    this.ringRadius  = data.ringRadius || 4.2;

    // Spieler-Definitionen (unveränderlich)
    this._defs = {};
    (data.players || []).forEach(p => { this._defs[p.id] = { ...p }; });
    this.isSpectator = !!this._defs[selfId]?.isSpectator;

    // Three.js
    this._scene    = null;
    this._renderer = null;
    this._camera   = null;
    this._raf      = null;
    this._stopped  = false;

    // Laufende Avatar-States  { [id]: AvatarState }
    this._av = {};

    // Tastatur-State
    this.keys      = {};
    this._prevKeys = {};
    this.lastAttack = 0;
    this.stunUntil  = 0;
    this._lastMove  = 0;

    // Spiel-State
    this.countdown  = 3;
    this.gameActive = false;
    this._goFlash   = 0;

    // Hit-Ring-Effekte
    this._hitFx = [];

    // Touch-Steuerung
    this._joyLeft   = joyLeft;
    this._joyRight  = joyRight;
    this._touchSlap = false;   // wird von Joystick-Tap gesetzt, in _processInput konsumiert
    this._touchKick = false;

    // Event-Handler (gebundene Referenzen für sauberes Unbind)
    this._onKD     = e => this._onKeyDown(e);
    this._onKU     = e => { this.keys[e.key] = false; };
    this._onResize = ()  => this._handleResize();
  }

  // ── Lebenszyklus ───────────────────────────────────────────
  start() {
    this._buildDOM();
    this._buildScene();
    this._buildRing();
    this._spawnAvatars();
    this._bindSocket();
    window.addEventListener('keydown', this._onKD);
    window.addEventListener('keyup',   this._onKU);
    window.addEventListener('resize',  this._onResize);

    // Touch-Angriff-Callbacks registrieren (Tap auf Joystick-Kreis)
    if (this._joyLeft  && !this.isSpectator) this._joyLeft.onTap  = () => { this._touchSlap = true; };
    if (this._joyRight && !this.isSpectator) this._joyRight.onTap = () => { this._touchKick = true; };

    this._loop();
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;

    window.removeEventListener('keydown', this._onKD);
    window.removeEventListener('keyup',   this._onKU);
    window.removeEventListener('resize',  this._onResize);

    // Touch-Callbacks bereinigen
    if (this._joyLeft)  this._joyLeft.onTap  = null;
    if (this._joyRight) this._joyRight.onTap = null;

    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }

    this._unbindSocket();

    // Three.js-Ressourcen freigeben
    this._scene?.traverse(obj => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => m?.dispose());
    });
    this._renderer?.dispose();

    // DOM aufräumen
    const ov = document.getElementById('minigameOverlay');
    if (ov) { ov.innerHTML = ''; ov.classList.add('hidden'); }
  }

  // ── DOM-Grundstruktur ──────────────────────────────────────
  _buildDOM() {
    const ov = document.getElementById('minigameOverlay');
    ov.innerHTML = '';
    ov.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;',
      'z-index:100;background:#050010;overflow:hidden;'
    ].join('');
    ov.classList.remove('hidden');

    // Steuer-Hinweis
    const hint = document.createElement('div');
    hint.id = 'ksHint';
    hint.style.cssText = [
      'position:absolute;bottom:14px;left:50%;',
      'transform:translateX(-50%);z-index:20;',
      'color:rgba(255,255,255,.45);font:13px Arial;',
      'pointer-events:none;white-space:nowrap;'
    ].join('');
    const isTouchDev = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    hint.textContent = this.isSpectator
      ? '👁  Zuschauer-Modus'
      : isTouchDev
        ? '← Joystick: Bewegen | Tippen: 👊  ·  Tippen: 🦵 →'
        : 'WASD / Pfeiltasten bewegen  ·  LEERTASTE schlagen  ·  ENTER treten';
    if (isTouchDev && !this.isSpectator) hint.style.bottom = '158px';
    ov.appendChild(hint);
  }

  // ── Three.js Szene ─────────────────────────────────────────
  _buildScene() {
    const ov = document.getElementById('minigameOverlay');
    const W  = window.innerWidth;
    const H  = window.innerHeight;

    // Renderer
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(W, H);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this._renderer.domElement.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
    ov.insertBefore(this._renderer.domElement, ov.firstChild);

    // Szene
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x050010);
    this._scene.fog = new THREE.FogExp2(0x05000f, 0.020);

    // Kamera: leicht erhöhte Schrägaufsicht
    this._camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 100);
    this._camera.position.set(0, 21, 14);
    this._camera.lookAt(0, 1.2, 0);

    // ── Beleuchtung ─────────────────────────────────────────
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.60));

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.05);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left   = -14;
    sun.shadow.camera.right  =  14;
    sun.shadow.camera.top    =  14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far    =  50;
    this._scene.add(sun);

    // Spot direkt über dem Ring
    const spot = new THREE.SpotLight(0xffe0b0, 0.9, 40, Math.PI * 0.2, 0.35);
    spot.position.set(0, 20, 0);
    this._scene.add(spot);
    this._scene.add(spot.target);   // target bleibt bei (0,0,0)

    // Stimmungs-Lichter links/rechts
    const rL = new THREE.PointLight(0xff2200, 0.5, 20);
    rL.position.set(-10, 4, 0);
    this._scene.add(rL);
    const bL = new THREE.PointLight(0x2244ff, 0.5, 20);
    bL.position.set( 10, 4, 0);
    this._scene.add(bL);
  }

  _handleResize() {
    if (!this._renderer || !this._camera) return;
    const W = window.innerWidth, H = window.innerHeight;
    this._camera.aspect = W / H;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(W, H);
  }

  // ── Ring-Geometrie ─────────────────────────────────────────
  _buildRing() {
    const R  = this.ringRadius * SCALE;   // Three.js Ring-Radius
    const sc = this._scene;

    // Aussenbereich (dunkle Disc)
    sc.add(_flat(new THREE.CircleGeometry(R + 3.5, 72),
      new THREE.MeshLambertMaterial({ color: 0x0e0508 })));

    // Matte Rand (dunkleres Orange)
    sc.add(_flat(new THREE.CircleGeometry(R + 0.9, 72),
      new THREE.MeshLambertMaterial({ color: 0xbf4010 }), 0.01));

    // Spielfläche (helleres Orange)
    sc.add(_flat(new THREE.CircleGeometry(R - 0.05, 72),
      new THREE.MeshLambertMaterial({ color: 0xd45020 }), 0.02));

    // Mittelkreis
    sc.add(_flat(new THREE.RingGeometry(0.55, 0.75, 48),
      new THREE.MeshBasicMaterial({ color: 0xffcc44, side: THREE.DoubleSide }), 0.03));

    // Seile (3 Torus-Ringe in verschiedenen Höhen)
    const ropes = [
      { h: 0.85, col: 0xdd1111, r: 0.062 },
      { h: 1.45, col: 0xeeeeee, r: 0.055 },
      { h: 2.05, col: 0xdd1111, r: 0.062 },
    ];
    ropes.forEach(({ h, col, r }) => {
      const rope = new THREE.Mesh(
        new THREE.TorusGeometry(R, r, 10, 96),
        new THREE.MeshLambertMaterial({ color: col })
      );
      rope.rotation.x = Math.PI / 2;   // Torus in XY-Ebene → waagerecht (XZ-Ebene)
      rope.position.y = h;
      rope.castShadow = true;
      sc.add(rope);
    });

    // Eckpfosten (4 Stück)
    const postCols = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f];
    for (let i = 0; i < 4; i++) {
      const a  = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = Math.cos(a) * (R + 0.65);
      const pz = Math.sin(a) * (R + 0.65);

      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.16, 2.6, 12),
        new THREE.MeshLambertMaterial({ color: postCols[i] })
      );
      post.position.set(px, 1.3, pz);
      post.castShadow = true;
      sc.add(post);

      // Kappe
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.20, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0xffffff })
      );
      cap.position.set(px, 2.65, pz);
      sc.add(cap);
    }
  }

  // ── Avatare spawnen ────────────────────────────────────────
  _spawnAvatars() {
    Object.values(this._defs).forEach(pd => {
      if (pd.isSpectator) return;

      const parts = createAvatarMesh(
        pd.faceData   || null,
        pd.shirtColor || '#5b9bd5',
        pd.skinColor  || '#ffce9e'
      );
      const group = parts.group;

      const sx = sw(pd.x ?? 5);
      const sz = sw(pd.y ?? 5);
      group.position.set(sx, 0, sz);
      group.castShadow    = true;
      group.receiveShadow = false;

      // Initial zur Ringmitte schauen
      group.rotation.y = Math.atan2(0 - sx, 0 - sz);

      // Name-Tag
      const nameTag = createNameTag(pd.name || '?');
      nameTag.position.y = 3.85;
      group.add(nameTag);

      // Eigener Spieler → gelber Bodenring
      if (pd.id === this.selfId) {
        const selfRing = new THREE.Mesh(
          new THREE.RingGeometry(0.58, 0.78, 40),
          new THREE.MeshBasicMaterial({
            color: 0xffff00, side: THREE.DoubleSide,
            transparent: true, opacity: 0.72
          })
        );
        selfRing.rotation.x = -Math.PI / 2;
        selfRing.position.y  =  0.03;
        group.add(selfRing);
      }

      this._scene.add(group);

      this._av[pd.id] = {
        group, parts, nameTag,
        x: pd.x ?? 5,  y: pd.y ?? 5,
        targetX: pd.x ?? 5, targetY: pd.y ?? 5,
        rotY: group.rotation.y,
        eliminated: false, _elimT: 0,
        _kickT: 0, _slapT: 0, _hitT: 0,
      };
    });
  }

  // ── Tastatur-Input ─────────────────────────────────────────
  _onKeyDown(e) {
    const mk = ['w','a','s','d',' ','Enter',
                'ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    if (mk.includes(e.key)) e.preventDefault();
    this.keys[e.key] = true;
  }

  _processInput() {
    const av = this._av[this.selfId];
    if (!av || av.eliminated) return;
    const now = Date.now();
    const K   = this.keys;

    // ── Bewegung (Tastatur) ───────────────────────────────────
    let dx = 0, dy = 0;
    if (K['w'] || K['ArrowUp'])    dy -= 1;
    if (K['s'] || K['ArrowDown'])  dy += 1;
    if (K['a'] || K['ArrowLeft'])  dx -= 1;
    if (K['d'] || K['ArrowRight']) dx += 1;

    // ── Bewegung (linker Joystick) ────────────────────────────
    // Joystick dy: Finger nach oben = negatives dy = Avatar läuft in Ring-Richtung oben
    if (this._joyLeft && this._joyLeft.active && this._joyLeft.mag > 0.08) {
      dx += this._joyLeft.dx;
      dy += this._joyLeft.dy;
    }

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;

      let nx = av.x + dx * 0.038;
      let ny = av.y + dy * 0.038;

      // Ringgrenze (Server-Koordinaten)
      if (Math.hypot(nx - 5, ny - 5) > this.ringRadius) {
        const a = Math.atan2(ny - 5, nx - 5);
        nx = 5 + Math.cos(a) * this.ringRadius;
        ny = 5 + Math.sin(a) * this.ringRadius;
      }

      av.x = av.targetX = nx;
      av.y = av.targetY = ny;
      // dx → Three.js X-Richtung, dy → Three.js Z-Richtung
      av.rotY = Math.atan2(dx, dy);

      if (now - this._lastMove > 50) {
        this.socket.emit('ks:move', { x: nx, y: ny });
        this._lastMove = now;
      }
    }

    // ── Angriff ────────────────────────────────────────────────
    const ready = now > this.lastAttack + 250 && now >= this.stunUntil;

    // Tastatur
    if (K[' '] && !this._prevKeys[' '] && ready) {
      this.socket.emit('ks:attack', { type: 'slap' });
      this.lastAttack = now;
      av._slapT = now;
    }
    if (K['Enter'] && !this._prevKeys['Enter'] && ready) {
      this.socket.emit('ks:attack', { type: 'kick' });
      this.lastAttack = now;
      av._kickT = now;
    }

    // Touch-Tap auf Joystick-Kreise
    if (this._touchSlap) {
      this._touchSlap = false;
      if (ready) {
        this.socket.emit('ks:attack', { type: 'slap' });
        this.lastAttack = now;
        av._slapT = now;
      }
    }
    if (this._touchKick) {
      this._touchKick = false;
      if (ready) {
        this.socket.emit('ks:attack', { type: 'kick' });
        this.lastAttack = now;
        av._kickT = now;
      }
    }

    this._prevKeys = { ...K };
  }

  // ── Socket-Events ──────────────────────────────────────────
  _bindSocket() {
    this._handlers = {
      'ks:countdown': n => {
        this.countdown = n;
      },
      'ks:go': () => {
        this.gameActive = true;
        this.countdown  = 0;
        this._goFlash   = Date.now();
      },
      'ks:moved': ({ id, x, y }) => {
        const av = this._av[id];
        if (!av || av.eliminated) return;
        const dx = x - av.targetX, dy = y - av.targetY;
        if (Math.hypot(dx, dy) > 0.005) av.rotY = Math.atan2(dx, dy);
        av.targetX = x; av.targetY = y;
      },
      'ks:hit': ({ attackerId, targetId, type, targetX, targetY, eliminated }) => {
        const target = this._av[targetId];
        const atk    = this._av[attackerId];
        if (target) {
          target.targetX = targetX; target.targetY = targetY;
          target._hitT   = Date.now();
          if (eliminated) { target.eliminated = true; target._elimT = Date.now(); }
          if (targetId === this.selfId) this.stunUntil = Date.now() + 300;
          this._addHitFx(sw(targetX), sw(targetY));
        }
        if (atk) {
          if (type === 'kick') atk._kickT = Date.now();
          if (type === 'slap') atk._slapT = Date.now();
        }
      },
      'ks:miss': () => { /* kein Feedback nötig */ },
      'ks:end':  data => { this.gameActive = false; this._showEnd(data); },
    };
    Object.entries(this._handlers).forEach(([ev, h]) => this.socket.on(ev, h));
  }

  _unbindSocket() {
    if (!this._handlers) return;
    Object.entries(this._handlers).forEach(([ev, h]) => this.socket.off(ev, h));
  }

  // ── Hit-Ring-Effekte ───────────────────────────────────────
  _addHitFx(x, z) {
    const mat  = new THREE.MeshBasicMaterial({
      color: 0xff5500, transparent: true, opacity: 0.90,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.42, 28), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    this._scene.add(mesh);
    this._hitFx.push({ mesh, mat, t0: performance.now() });
  }

  _tickHitFx() {
    const now = performance.now();
    this._hitFx = this._hitFx.filter(fx => {
      const t = (now - fx.t0) / 550;
      if (t >= 1) {
        this._scene.remove(fx.mesh);
        fx.mesh.geometry.dispose(); fx.mat.dispose();
        return false;
      }
      const s = 1 + t * 3.0;
      fx.mesh.scale.set(s, s, s);
      fx.mat.opacity = 0.90 * (1 - t);
      return true;
    });
  }

  // ── Render-Loop ────────────────────────────────────────────
  _loop() {
    if (this._stopped) return;
    this._raf = requestAnimationFrame(() => this._loop());
    if (this.gameActive && !this.isSpectator) this._processInput();
    this._tickAvatars();
    this._tickHitFx();
    this._tickHUD();
    this._renderer.render(this._scene, this._camera);
  }

  // ── Avatar-Animationen ─────────────────────────────────────
  _tickAvatars() {
    const now  = Date.now();
    const ANIM = ANIM_MS;

    Object.values(this._av).forEach(av => {
      const { group, parts } = av;

      // ── Ausgeschieden: Avatar kippt zur Seite ──────────────
      if (av.eliminated) {
        const t = Math.min(1, (now - av._elimT) / 700);
        group.rotation.z = t * (Math.PI / 2);
        group.position.y = -(t * 0.45);
        if (av.nameTag) av.nameTag.lookAt(this._camera.position);
        return;
      }

      // ── Position interpolieren ─────────────────────────────
      av.x += (av.targetX - av.x) * 0.20;
      av.y += (av.targetY - av.y) * 0.20;
      group.position.x = sw(av.x);
      group.position.z = sw(av.y);
      group.position.y = 0;
      group.rotation.z = 0;

      // ── Rotation glätten ───────────────────────────────────
      let dR = av.rotY - group.rotation.y;
      while (dR >  Math.PI) dR -= Math.PI * 2;
      while (dR < -Math.PI) dR += Math.PI * 2;
      group.rotation.y += dR * 0.14;

      // ── Name-Tag immer zur Kamera ──────────────────────────
      if (av.nameTag) av.nameTag.lookAt(this._camera.position);

      // ── Pose wählen ────────────────────────────────────────
      const kickAge = av._kickT ? now - av._kickT : Infinity;
      const slapAge = av._slapT ? now - av._slapT : Infinity;
      const hitAge  = av._hitT  ? now - av._hitT  : Infinity;

      if (kickAge < ANIM) {
        // ─ TRITT: rechtes Bein 90° nach vorne ─────────────
        const t     = kickAge / ANIM;
        const angle = Math.sin(t * Math.PI) * (Math.PI / 2);
        parts.rLegPivot.rotation.x = -angle;
        parts.lLegPivot.rotation.x =  angle * 0.18;
        // Arme balancieren leicht gegen
        parts.rArmPivot.rotation.x =  angle * 0.25;
        parts.lArmPivot.rotation.x = -angle * 0.10;
        parts.rArmPivot.rotation.z =  0;
        parts.lArmPivot.rotation.z =  0;
        group.rotation.x =  0;

      } else if (slapAge < ANIM) {
        // ─ SCHLAG: rechter Arm 90° nach vorne ─────────────
        const t     = slapAge / ANIM;
        const angle = Math.sin(t * Math.PI) * (Math.PI / 2);
        parts.rArmPivot.rotation.x = -angle;
        parts.lArmPivot.rotation.x =  angle * 0.10;
        parts.rArmPivot.rotation.z = -angle * 0.35;   // Arm leicht nach außen
        parts.lArmPivot.rotation.z =  0;
        parts.rLegPivot.rotation.x =  0;
        parts.lLegPivot.rotation.x =  0;
        group.rotation.x =  0;

      } else {
        // ─ AC-Laufen / Idle ────────────────────────────────
        const moving = Math.hypot(av.targetX - av.x, av.targetY - av.y) > 0.008;
        const t      = now * 0.0058;
        const cycle  = Math.sin(t);
        const abs    = Math.abs(cycle);

        if (moving) {
          parts.lArmPivot.rotation.x =  cycle * 0.65;
          parts.rArmPivot.rotation.x = -cycle * 0.65;
          parts.lArmPivot.rotation.z = -abs   * 0.18;
          parts.rArmPivot.rotation.z =  abs   * 0.18;
          parts.lLegPivot.rotation.x = -cycle * 0.55;
          parts.rLegPivot.rotation.x =  cycle * 0.55;
          group.rotation.x = 0.055;
          if (parts.body) {
            parts.body.scale.y = 1 + (1 - abs) * 0.06;
            parts.body.scale.x = 1 - (1 - abs) * 0.03;
          }
          if (parts.head) parts.head.position.y = 2.62 - abs * 0.04;
        } else {
          parts.lArmPivot.rotation.x *= 0.78;
          parts.rArmPivot.rotation.x *= 0.78;
          parts.lArmPivot.rotation.z *= 0.78;
          parts.rArmPivot.rotation.z *= 0.78;
          parts.lLegPivot.rotation.x *= 0.78;
          parts.rLegPivot.rotation.x *= 0.78;
          group.rotation.x *= 0.80;
          if (parts.body) {
            const breath = Math.sin(now * 0.0013) * 0.018;
            parts.body.scale.y = 1 + breath;
            parts.body.scale.x = 1 - breath * 0.4;
          }
          if (parts.head)
            parts.head.position.y += (2.62 - parts.head.position.y) * 0.12;
        }
      }

      // ── Treffer-Pulsation ──────────────────────────────────
      if (hitAge < 280) {
        const f = Math.sin((hitAge / 280) * Math.PI) * 0.14;
        group.scale.set(1 + f, 1 + f * 0.5, 1 + f);
      } else {
        group.scale.set(1, 1, 1);
      }
    });
  }

  // ── HUD: Countdown, GO!, Status-Dot ───────────────────────
  _tickHUD() {
    const ov = document.getElementById('minigameOverlay');
    if (!ov) return;

    // Countdown
    let cdEl = document.getElementById('ksCD');
    if (this.countdown > 0) {
      if (!cdEl) {
        cdEl = document.createElement('div');
        cdEl.id = 'ksCD';
        cdEl.style.cssText = [
          'position:absolute;top:50%;left:50%;',
          'transform:translate(-50%,-50%);',
          'font:bold 180px Arial;',
          'color:#ff6600;',
          'text-shadow:0 0 40px #ff3300,0 0 80px #ff3300;',
          'pointer-events:none;z-index:20;user-select:none;'
        ].join('');
        ov.appendChild(cdEl);
      }
      cdEl.textContent = this.countdown;
    } else {
      cdEl?.remove();
    }

    // GO!
    const goAge = this._goFlash ? Date.now() - this._goFlash : 9999;
    let goEl = document.getElementById('ksGo');
    if (goAge < 900) {
      if (!goEl) {
        goEl = document.createElement('div');
        goEl.id = 'ksGo';
        goEl.style.cssText = [
          'position:absolute;top:50%;left:50%;',
          'font:bold 160px Arial;color:#ffff00;',
          'text-shadow:0 0 40px #ffaa00;',
          'pointer-events:none;z-index:20;user-select:none;'
        ].join('');
        goEl.textContent = 'GO!';
        ov.appendChild(goEl);
      }
      const t = goAge / 900;
      goEl.style.transform = `translate(-50%,-50%) scale(${1 + t * 0.5})`;
      goEl.style.opacity   = String(1 - t);
    } else {
      goEl?.remove();
    }

    // Status-Dot (Bereit / Betäubt)
    if (!this.isSpectator && this.gameActive) {
      let dot = document.getElementById('ksDot');
      if (!dot) {
        dot = document.createElement('div');
        dot.id = 'ksDot';
        dot.style.cssText = [
          'position:absolute;top:16px;left:16px;z-index:20;',
          'width:18px;height:18px;border-radius:50%;',
          'border:2px solid rgba(255,255,255,.5);',
          'pointer-events:none;'
        ].join('');
        ov.appendChild(dot);
      }
      const now     = Date.now();
      const stunned = now < this.stunUntil;
      const ready   = !stunned && now > this.lastAttack + 250;
      dot.style.background = ready ? '#4ade80' : stunned ? '#f87171' : '#fbbf24';
    }
  }

  // ── Sieg-Bildschirm ────────────────────────────────────────
  _showEnd({ winnerId, rankings }) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }

    const ov = document.getElementById('minigameOverlay');
    if (!ov) return;

    const end = document.createElement('div');
    end.style.cssText = [
      'position:absolute;top:50%;left:50%;',
      'transform:translate(-50%,-50%);',
      'background:rgba(4,0,14,0.97);',
      'border:2px solid #ffd700;border-radius:16px;',
      'padding:30px 46px;z-index:30;text-align:center;',
      'box-shadow:0 0 60px rgba(255,200,0,.45);',
      'min-width:300px;'
    ].join('');

    const trophy = document.createElement('div');
    trophy.style.cssText = 'font-size:52px;margin-bottom:8px;';
    trophy.textContent   = '🏆';
    end.appendChild(trophy);

    const winner = this._defs[winnerId];
    const wEl    = document.createElement('div');
    wEl.style.cssText = 'color:#ffd700;font:bold 26px Arial;margin-bottom:16px;';
    wEl.textContent   = winner ? `${winner.name} gewinnt!` : 'Unentschieden';
    end.appendChild(wEl);

    const medals = ['🥇', '🥈', '🥉'];
    (rankings || []).slice(0, 6).forEach(({ name }, i) => {
      const col = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0'
                : i === 2 ? '#cd7f32' : 'rgba(255,255,255,.5)';
      const row = document.createElement('div');
      row.style.cssText = `color:${col};font:${i < 3 ? 'bold ' : ''}17px Arial;margin:4px 0;`;
      row.textContent   = `${medals[i] || (i + 1) + '.'} ${name}`;
      end.appendChild(row);
    });

    const hint = document.createElement('div');
    hint.style.cssText = 'color:rgba(255,255,255,.28);font:12px Arial;margin-top:18px;';
    hint.textContent   = 'Schließt in 5 Sekunden…';
    end.appendChild(hint);

    ov.appendChild(end);

    // Renderer läuft weiter damit die Avatare sichtbar bleiben
    const loop = () => {
      if (this._stopped) return;
      this._raf = requestAnimationFrame(loop);
      this._tickAvatars();
      this._renderer.render(this._scene, this._camera);
    };
    loop();

    setTimeout(() => this.stop(), 5000);
  }
}

// ── Hilfsfunktionen ────────────────────────────────────────────
// Flache (horizontale) Disc mit optionalem Y-Offset
function _flat(geo, mat, y = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x    = -Math.PI / 2;
  m.position.y    =  y;
  m.receiveShadow =  true;
  return m;
}
