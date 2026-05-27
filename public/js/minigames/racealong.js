// ─────────────────────────────────────────────────────────────
// Racealong – Client-seitiges Minigame
// ─────────────────────────────────────────────────────────────

// ── Strecken-Mittellinie (Weltkoordinaten 0-600 / 0-500) ──────
// Punkte bilden eine geschlossene Schleife.
// Gesamtlänge ≈ 1900 px → bei Grundtempo 95 px/s ≈ 20 s Ideallinie.
const TRACK_PTS = [
  [300, 60],   // 0 – Start/Ziel (oben Mitte)
  [420, 60],
  [500, 80],
  [545, 140],
  [545, 220],
  [500, 270],
  [430, 270],
  [390, 310],
  [430, 355],
  [545, 370],
  [545, 440],
  [480, 480],
  [360, 490],
  [200, 490],
  [100, 460],
  [55,  390],
  [55,  300],
  [110, 250],
  [180, 250],
  [220, 210],
  [180, 170],
  [100, 150],
  [55,  90],
  [100, 60],
  [200, 58],
  [300, 60],   // zurück zum Start
];

const HALF_W     = 28;   // halbe Streckenbreite in Welteinheiten
const FRICTION_Z = 10;   // Reibungszone ab dieser Distanz von der Wand
const BASE_SPD   = 95;   // px/s (Ideallinie)
const TURN_SPD   = 190;  // px/s (turns-per-second × Welteinheiten, nur Richtungsinput)
const PLAYER_R   = 10;   // Radius des Spielerkreises

// Ziellinie: zwischen Punkt 0 und Punkt 1 (x-Übergang bei y≈60, x 200..420)
const FINISH_X1 = 200, FINISH_X2 = 420, FINISH_Y = 60, FINISH_TOL = 20;
// Checkpoint: Punkt ~12 (rechts unten), Spieler muss ihn passieren
const CKPT_X1 = 300, CKPT_X2 = 550, CKPT_Y = 435, CKPT_TOL = 30;

export class RacealongGame {
  /**
   * @param {string} selfId
   * @param {object} data
   * @param {object} socket
   * @param {import('../joystick.js').VirtualJoystick|null} joyLeft – linker Joystick (Fahren)
   */
  constructor(selfId, data, socket, joyLeft = null) {
    this.selfId  = selfId;
    this.socket  = socket;
    this._joyLeft = joyLeft;
    this.players = {};
    (data.players || []).forEach(p => {
      this.players[p.id] = {
        id: p.id, name: p.name,
        faceData: p.faceData || null, skinColor: p.skinColor || '#ffce9e',
        x: p.startX || 300, y: p.startY || 80,
        dir: 0,            // Laufrichtung in Radiant (0 = nach oben)
        speed: BASE_SPD,
        finished: false, finishRank: 0,
        _ckpt: false,      // Checkpoint passiert?
      };
    });

    this.gameActive   = false;
    this.countdown    = 3;
    this.rankings     = [];
    this._goFlash     = 0;
    this.keys         = {};
    this.raf          = null;
    this._lastTs      = 0;
    this._lastSend    = 0;

    this._onKD = e => {
      const moved = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'];
      if (moved.includes(e.key)) e.preventDefault();
      this.keys[e.key] = true;
    };
    this._onKU = e => { this.keys[e.key] = false; };

    // Face-Bilder
    this.faceImgs = {};
    (data.players || []).forEach(p => {
      if (!p.faceData) return;
      const img = new Image(); img.src = p.faceData;
      this.faceImgs[p.id] = img;
    });
  }

  // ── Lebenszyklus ───────────────────────────────────────────
  start() {
    this._buildDOM();
    this._bindSocket();
    window.addEventListener('keydown', this._onKD);
    window.addEventListener('keyup',   this._onKU);
    this._lastTs = performance.now();
    this._loop();
  }

  stop() {
    const ov = document.getElementById('minigameOverlay');
    if (ov) ov.classList.add('hidden');
    this._unbindSocket();
    window.removeEventListener('keydown', this._onKD);
    window.removeEventListener('keyup',   this._onKU);
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  // ── DOM ────────────────────────────────────────────────────
  _buildDOM() {
    const ov = document.getElementById('minigameOverlay');
    ov.innerHTML = '';
    ov.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100;',
      'background:#0a100a;display:flex;align-items:center;',
      'justify-content:center;flex-direction:column;gap:8px;'
    ].join('');

    const title = _el('div', 'color:#fff;font:bold 26px Arial;letter-spacing:3px;');
    title.textContent = '🏁  Racealong';
    ov.appendChild(title);

    // Canvas
    const maxW  = window.innerWidth  - 16;
    const maxH  = window.innerHeight - 110;
    const scale = Math.min(maxW / 600, maxH / 500, 1);
    const CW    = Math.floor(600 * scale);
    const CH    = Math.floor(500 * scale);

    const canvas = document.createElement('canvas');
    canvas.width  = 600;
    canvas.height = 500;
    canvas.style.cssText = `width:${CW}px;height:${CH}px;` +
      'border-radius:10px;box-shadow:0 0 30px rgba(100,200,100,.3);';
    ov.appendChild(canvas);
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    const hint = _el('div', 'color:rgba(255,255,255,.5);font:13px Arial;');
    const isTouchDev = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    hint.textContent = isTouchDev
      ? 'Linker Joystick steuern – Nah an der Wand = langsamer'
      : 'WASD / Pfeiltasten – Nah an der Wand = langsamer';
    ov.appendChild(hint);

    ov.classList.remove('hidden');
  }

  // ── Hauptschleife ──────────────────────────────────────────
  _loop() {
    this.raf = requestAnimationFrame(ts => {
      const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
      this._lastTs = ts;
      if (this.gameActive) this._update(dt);
      this._render();
      this._loop();
    });
  }

  // ── Update (client-side Physik) ────────────────────────────
  _update(dt) {
    const self = this.players[this.selfId];
    if (!self || self.finished) return;

    const K  = this.keys;
    let dx = 0, dy = 0;
    if (K['w'] || K['ArrowUp'])    dy -= 1;
    if (K['s'] || K['ArrowDown'])  dy += 1;
    if (K['a'] || K['ArrowLeft'])  dx -= 1;
    if (K['d'] || K['ArrowRight']) dx += 1;

    // Joystick: dy-Achse (+unten/-oben) passt direkt zur Track-Koordinate
    if (this._joyLeft && this._joyLeft.active && this._joyLeft.mag > 0.08) {
      dx += this._joyLeft.dx;
      dy += this._joyLeft.dy;
    }

    if (dx === 0 && dy === 0) return;

    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;

    // Wandnähe am aktuellen Standpunkt → Reibung bestimmen
    const cur  = _closestOnTrack(self.x, self.y);
    const wDist = HALF_W - cur.dist;   // Abstand zur nächsten Wand (negativ = ausserhalb)
    let spd = BASE_SPD;
    if (wDist < FRICTION_Z && wDist >= 0) {
      spd = BASE_SPD * (0.5 + 0.5 * wDist / FRICTION_Z);
    } else if (wDist < 0) {
      spd = BASE_SPD * 0.3;            // auf Gras – stark gebremst
    }

    let nx = self.x + dx * spd * dt;
    let ny = self.y + dy * spd * dt;

    // Kollision: Spieler aus Wand herausschieben (entlang Streckennormale)
    const cl = _closestOnTrack(nx, ny);
    const limit = HALF_W - PLAYER_R;
    if (cl.dist > limit) {
      const over = cl.dist - limit;
      nx -= cl.nx * over;
      ny -= cl.ny * over;
    }

    self.x   = nx;
    self.y   = ny;
    self.dir = Math.atan2(dx, -dy);    // 0 = nach oben

    // Checkpoint prüfen (muss passiert werden, bevor Ziel gilt)
    if (!self._ckpt &&
        ny >= CKPT_Y - CKPT_TOL && ny <= CKPT_Y + CKPT_TOL &&
        nx >= CKPT_X1 && nx <= CKPT_X2) {
      self._ckpt = true;
    }

    // Ziellinie (nur nach Checkpoint – kein Richtungscheck nötig)
    if (self._ckpt &&
        ny >= FINISH_Y - FINISH_TOL && ny <= FINISH_Y + FINISH_TOL &&
        nx >= FINISH_X1 && nx <= FINISH_X2) {
      self.finished = true;
      this.socket.emit('ra:finish');
    }

    // Position senden (gedrosselt ~25×/s)
    const now = performance.now();
    if (now - this._lastSend > 40) {
      this.socket.emit('ra:moved', { x: self.x, y: self.y, dir: self.dir });
      this._lastSend = now;
    }
  }

  // ── Render ─────────────────────────────────────────────────
  _render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = 600, H = 500;

    // ── Hintergrund (Gras) ──
    ctx.fillStyle = '#1a3a1a';
    ctx.fillRect(0, 0, W, H);

    // ── Streckenfläche (dicker Strich entlang Mittellinie) ──
    ctx.beginPath();
    TRACK_PTS.forEach((p, i) => { i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); });
    ctx.closePath();
    ctx.strokeStyle = '#404040';
    ctx.lineWidth   = HALF_W * 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // ── Randmarkierungen (weiße Linie) ──
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // ── Mittellinie (gestrichelt) ──
    ctx.setLineDash([14, 12]);
    ctx.strokeStyle = 'rgba(255,255,100,.18)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Ziellinie ──
    _drawCheckerLine(ctx, FINISH_X1, FINISH_Y, FINISH_X2, FINISH_Y, 6);

    // ── Checkpoint (halbtransparent) ──
    ctx.strokeStyle = 'rgba(80,160,255,.5)';
    ctx.lineWidth   = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(CKPT_X1, CKPT_Y);
    ctx.lineTo(CKPT_X2, CKPT_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Spieler ──
    const sorted = Object.values(this.players).sort((a, b) => a.id === this.selfId ? 1 : -1);
    sorted.forEach(p => this._drawPlayer(ctx, p));

    // ── Countdown ──
    if (this.countdown > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff6600';
      ctx.font = 'bold 140px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.countdown, W / 2, H / 2);
    }

    // ── GO! ──
    if (this._goFlash && Date.now() - this._goFlash < 900) {
      const t = (Date.now() - this._goFlash) / 900;
      ctx.fillStyle = `rgba(0,0,0,${0.65 * (1 - t)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255,255,0,${1 - t})`;
      ctx.font = 'bold 110px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GO!', W / 2, H / 2);
    }

    // ── Rang-Anzeige oben rechts ──
    if (this.gameActive) {
      const places  = this.rankings.length;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(W - 130, 6, 124, places > 0 ? places * 22 + 18 : 28);
      ctx.font = '13px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      (this.rankings.length ? this.rankings : Object.values(this.players).map(p => ({ id: p.id, name: p.name })))
        .forEach(({ id, name }, i) => {
          ctx.fillStyle = id === this.selfId ? '#ffff88' : '#fff';
          ctx.fillText(`${i + 1}. ${name}`, W - 124, 12 + i * 22);
        });
    }
  }

  _drawPlayer(ctx, p) {
    const { x, y, dir } = p;
    const r  = PLAYER_R;
    const isMe = p.id === this.selfId;

    // Richtungsdreieck
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir);
    ctx.beginPath();
    ctx.moveTo(0, -r - 6);
    ctx.lineTo(5, -r);
    ctx.lineTo(-5, -r);
    ctx.closePath();
    ctx.fillStyle = isMe ? '#ffff44' : '#ffffff';
    ctx.fill();
    ctx.restore();

    // Körperkreis
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.skinColor || '#ffce9e';
    ctx.fill();
    ctx.strokeStyle = isMe ? '#ffff00' : '#fff';
    ctx.lineWidth   = isMe ? 2.5 : 1.5;
    ctx.stroke();

    // Gesicht
    const img = this.faceImgs[p.id];
    if (img?.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, x - r + 1, y - r + 1, (r - 1) * 2, (r - 1) * 2);
      ctx.restore();
    }

    // Ziel-Flagge wenn fertig
    if (p.finished) {
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('🏁', x, y - r - 4);
    } else {
      // Name
      ctx.font = `${isMe ? 'bold ' : ''}11px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
      ctx.strokeText(p.name, x, y - r - 2);
      ctx.fillStyle = isMe ? '#ffff88' : '#fff';
      ctx.fillText(p.name, x, y - r - 2);
    }
  }

  // ── Socket ─────────────────────────────────────────────────
  _bindSocket() {
    this.socket.on('ra:countdown', n => {
      this.countdown = n;
    });

    this.socket.on('ra:go', () => {
      this.gameActive = true;
      this.countdown  = 0;
      this._goFlash   = Date.now();
    });

    this.socket.on('ra:moved', ({ id, x, y, dir }) => {
      if (this.players[id] && id !== this.selfId) {
        this.players[id].x = x;
        this.players[id].y = y;
        this.players[id].dir = dir;
      }
    });

    this.socket.on('ra:ranked', ({ id, rank, rankings }) => {
      if (this.players[id]) {
        this.players[id].finished  = true;
        this.players[id].finishRank = rank;
      }
      this.rankings = rankings || [];
    });

    this.socket.on('ra:result', ({ rankings }) => {
      this.gameActive = false;
      this.rankings   = rankings || [];
      this._showResult(rankings);
    });

    this.socket.on('ra:done', () => {
      setTimeout(() => this.stop(), 800);
    });
  }

  _unbindSocket() {
    ['ra:countdown','ra:go','ra:moved','ra:ranked','ra:result','ra:done']
      .forEach(e => this.socket.off(e));
  }

  // ── Ergebnis-Screen ────────────────────────────────────────
  _showResult(rankings) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    const ctx = this.ctx;
    if (!ctx) return;
    const W = 600, H = 500;
    const medals = ['🥇','🥈','🥉'];

    const draw = () => {
      ctx.fillStyle = '#0a100a'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 48px Arial';
      ctx.textBaseline = 'top';
      ctx.fillText('🏁 Zielankunft 🏁', W / 2, 40);

      (rankings || []).forEach(({ id, name }, i) => {
        const isMe = id === this.selfId;
        ctx.font   = `${i === 0 ? 'bold 34px' : '26px'} Arial`;
        ctx.fillStyle = isMe ? '#ffff88' : (i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : '#cd7f32');
        ctx.fillText(`${medals[i] || (i + 1) + '.'}  ${name}`, W / 2, 120 + i * 60);
      });

      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.font = '16px Arial';
      ctx.fillText('Schließt in 6 Sekunden…', W / 2, H - 30);
    };

    draw();
    const loop = () => { this.raf = requestAnimationFrame(loop); draw(); };
    loop();
    setTimeout(() => this.stop(), 6000);
  }
}

// ── Strecken-Hilfsfunktionen ───────────────────────────────────

/** Gibt den nächsten Punkt auf der Mittellinie zurück + normalisierten Abstandsvektor */
function _closestOnTrack(px, py) {
  let minDist = Infinity, cx = px, cy = py, nx = 0, ny = -1;
  const pts = TRACK_PTS;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0],   ay = pts[i][1];
    const bx = pts[i+1][0], by = pts[i+1][1];
    const abx = bx - ax, aby = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
    const qx = ax + t * abx, qy = ay + t * aby;
    const dx = px - qx, dy = py - qy;
    const d  = Math.hypot(dx, dy);
    if (d < minDist) { minDist = d; cx = qx; cy = qy; nx = d > 0 ? dx / d : 0; ny = d > 0 ? dy / d : 0; }
  }
  return { dist: minDist, cx, cy, nx, ny };
}

/** Schachbrett-Linie (Ziellinie) */
function _drawCheckerLine(ctx, x1, y1, x2, y2, size) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / size);
  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(Math.atan2(dy, dx));
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#fff' : '#000';
      ctx.fillRect(i * size, j * size - size, size, size);
    }
  }
  ctx.restore();
}

function _el(tag, css = '') {
  const e = document.createElement(tag);
  e.style.cssText = css;
  return e;
}
