// ─────────────────────────────────────────────────────────────
// Flappy Chopper – Stand 7  (single-player)
// Flappy-Bird-Klon mit prozedural gezeichnetem Hubschrauber
// ─────────────────────────────────────────────────────────────

const W = 600, H = 400;

const GRAVITY      = 1350;   // px / s²
const FLAP_VY      = -435;   // Aufwärtsimpuls px / s
const HELI_X       = 110;    // feste horizontale Position
const HELI_RX      = 20;     // Kollisions-Halbbreite
const HELI_RY      = 11;     // Kollisions-Halbhöhe
const PIPE_W       = 58;
const PIPE_GAP     = 122;    // etwas größere Lücke
const BASE_SPEED   = 172;    // Scroll-Geschwindigkeit px/s
const PIPE_IV_BASE = 1.65;   // Sekunden zwischen Rohrpaaren
const PIPE_IV_MIN  = 1.28;   // kaum Beschleunigung

// ─────────────────────────────────────────────────────────────
export class FlappyChopperGame {

  /**
   * @param {string} selfId     Socket-ID des Spielers
   * @param {string} playerName Anzeigename (für Highscore)
   * @param {object} socket     Socket.io-Socket
   */
  constructor(selfId, playerName, socket) {
    this.selfId     = selfId;
    this.playerName = (playerName || 'Spieler').substring(0, 15);
    this.socket     = socket;

    this._overlay    = null;
    this._canvas     = null;
    this._ctx        = null;
    this._raf        = null;
    this._lastTs     = 0;

    // Spielzustand
    this._phase      = 'wait';   // 'wait' | 'play' | 'dead'
    this._y          = H / 2;
    this._vy         = 0;
    this._score      = 0;
    this._pipes      = [];
    this._pipeTimer  = PIPE_IV_BASE;
    this._speed      = BASE_SPEED;
    this._t          = 0;
    this._rotorAngle = 0;
    this._highscores = null;

    // Statische Hintergrund-Sterne (einmal berechnet)
    this._stars = Array.from({ length: 45 }, () => ({
      x: Math.random() * W,
      y: Math.random() * (H * 0.65),
      r: Math.random() * 1.4 + 0.5
    }));

    // Gebundene Event-Handler
    this._onKey    = this._onKey.bind(this);
    this._onClick  = this._onClick.bind(this);
    this._loop     = this._loop.bind(this);
    this._onHscore = this._onHscore.bind(this);
  }

  // ── Lifecycle ────────────────────────────────────────────────
  start() {
    this._overlay = document.getElementById('minigameOverlay');
    this._overlay.innerHTML = '';
    this._overlay.classList.remove('hidden');
    this._overlay.style.cssText =
      'position:fixed;inset:0;z-index:100;display:flex;' +
      'align-items:center;justify-content:center;background:#000;';

    const canvas   = document.createElement('canvas');
    canvas.width   = W;
    canvas.height  = H;
    canvas.style.cssText =
      'display:block;border-radius:12px;cursor:pointer;' +
      'box-shadow:0 0 40px rgba(60,200,120,.4);' +
      'max-width:min(600px,100vw);max-height:min(400px,100vh);';
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._overlay.appendChild(canvas);

    window.addEventListener('keydown', this._onKey, { passive: false });
    canvas.addEventListener('click',      this._onClick);
    // Touch-Tap auf Canvas = Fliegen (ohne auf Klick-Synthese warten)
    canvas.addEventListener('touchstart', e => { e.preventDefault(); this._handleInput(); },
      { passive: false });
    this.socket.on('fc:highscore', this._onHscore);

    this._lastTs = performance.now();
    this._raf    = requestAnimationFrame(this._loop);
  }

  stop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    window.removeEventListener('keydown', this._onKey);
    if (this.socket) this.socket.off('fc:highscore', this._onHscore);
    if (this._overlay) {
      this._overlay.innerHTML = '';
      this._overlay.classList.add('hidden');
      this._overlay.style.cssText = '';
      this._overlay = null;
    }
  }

  // ── Eingabe ──────────────────────────────────────────────────
  _onKey(e) {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      this._handleInput();
    }
    if (e.code === 'Escape') this.stop();
  }

  _onClick() { this._handleInput(); }

  _handleInput() {
    if (this._phase === 'dead') {
      this._resetGame();
    } else {
      this._flap();
    }
  }

  _flap() {
    if (this._phase === 'wait') this._phase = 'play';
    this._vy = FLAP_VY;
  }

  _resetGame() {
    this._phase     = 'wait';
    this._y         = H / 2;
    this._vy        = 0;
    this._score     = 0;
    this._pipes     = [];
    this._pipeTimer = PIPE_IV_BASE;
    this._speed     = BASE_SPEED;
    this._t         = 0;
  }

  // ── Server ───────────────────────────────────────────────────
  _onHscore(scores) {
    this._highscores = scores;
  }

  // ── Game Loop ────────────────────────────────────────────────
  _loop(ts) {
    const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
    this._lastTs = ts;
    if (this._phase === 'play') this._update(dt);
    this._draw();
    this._raf = requestAnimationFrame(this._loop);
  }

  _update(dt) {
    this._t          += dt;
    this._rotorAngle += dt * 22;
    // Sehr flacher Anstieg – Original Flappy Bird bleibt fast konstant
    this._speed       = BASE_SPEED + Math.min(this._score, 30) * 1.0;

    // Physik
    this._vy += GRAVITY * dt;
    this._y  += this._vy * dt;

    // Rohre spawnen
    this._pipeTimer -= dt;
    if (this._pipeTimer <= 0) {
      const interval   = Math.max(PIPE_IV_MIN, PIPE_IV_BASE - Math.min(this._score, 10) * 0.03);
      this._pipeTimer  = interval;
      const minTop     = 55;
      const maxTop     = H - 55 - PIPE_GAP;
      const gapY       = minTop + Math.random() * (maxTop - minTop);
      this._pipes.push({ x: W + 10, gapY, passed: false });
    }

    // Rohre scrollen + Punkte zählen
    for (const p of this._pipes) {
      p.x -= this._speed * dt;
      if (!p.passed && p.x + PIPE_W < HELI_X - HELI_RX) {
        p.passed = true;
        this._score++;
      }
    }
    this._pipes = this._pipes.filter(p => p.x + PIPE_W > -20);

    // Kollision Boden / Decke
    if (this._y - HELI_RY < 0 || this._y + HELI_RY > H - 28) {
      this._die(); return;
    }

    // Kollision Rohre (AABB)
    for (const p of this._pipes) {
      if (HELI_X + HELI_RX > p.x && HELI_X - HELI_RX < p.x + PIPE_W) {
        if (this._y - HELI_RY < p.gapY || this._y + HELI_RY > p.gapY + PIPE_GAP) {
          this._die(); return;
        }
      }
    }
  }

  _die() {
    this._phase = 'dead';
    if (this._score > 0) {
      this.socket.emit('fc:submitScore', { name: this.playerName, score: this._score });
    } else {
      this.socket.emit('fc:getHighscore');
    }
  }

  // ── Zeichnen ─────────────────────────────────────────────────
  _draw() {
    const ctx = this._ctx;

    // ── Hintergrund (Nachthimmel → Boden) ────────────────────
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,   '#070b20');
    sky.addColorStop(0.7, '#122840');
    sky.addColorStop(1,   '#1a3a20');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sterne
    ctx.fillStyle = '#ffffff';
    for (const s of this._stars) {
      const alpha = 0.35 + 0.35 * Math.sin(this._t * 0.6 + s.x * 0.04);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Mondsichel
    ctx.fillStyle = 'rgba(255,245,200,0.9)';
    ctx.beginPath();
    ctx.arc(W - 55, 45, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0f1e';
    ctx.beginPath();
    ctx.arc(W - 44, 42, 16, 0, Math.PI * 2);
    ctx.fill();

    // ── Boden ─────────────────────────────────────────────────
    ctx.fillStyle = '#1e4a14';
    ctx.fillRect(0, H - 28, W, 28);
    ctx.fillStyle = '#2d6e1e';
    ctx.fillRect(0, H - 28, W, 7);

    // ── Rohre ─────────────────────────────────────────────────
    this._drawPipes(ctx);

    // ── Hubschrauber ──────────────────────────────────────────
    if (this._phase !== 'wait') {
      this._drawHeli(ctx, HELI_X, this._y);
    } else {
      // Wartende Position
      const bobY = Math.sin(this._t * 2) * 5;
      this._drawHeli(ctx, HELI_X, H / 2 + bobY);
    }

    // ── Punkte-Anzeige ────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this._rrect(ctx, W / 2 - 34, 6, 68, 38, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(String(this._score), W / 2, 34);

    // ── Screens ───────────────────────────────────────────────
    if (this._phase === 'wait') this._drawWait(ctx);
    if (this._phase === 'dead') this._drawGameOver(ctx);
  }

  _drawPipes(ctx) {
    const mkGrad = (x) => {
      const g = ctx.createLinearGradient(x, 0, x + PIPE_W, 0);
      g.addColorStop(0,   '#176b2e');
      g.addColorStop(0.3, '#34b85c');
      g.addColorStop(0.7, '#34b85c');
      g.addColorStop(1,   '#176b2e');
      return g;
    };

    for (const p of this._pipes) {
      const topH = p.gapY;
      const botY = p.gapY + PIPE_GAP;
      const botH = H - botY;
      const grad = mkGrad(p.x);

      // ── Oberes Rohr ──────────────────────────────────────
      ctx.fillStyle = grad;
      ctx.fillRect(p.x, 0, PIPE_W, topH);
      // Kappe
      ctx.fillStyle = '#0f4d22';
      ctx.fillRect(p.x - 5, topH - 24, PIPE_W + 10, 24);
      // Glanzstreifen oben an der Kappe
      ctx.fillStyle = 'rgba(100,255,140,0.22)';
      ctx.fillRect(p.x - 5, topH - 24, PIPE_W + 10, 6);
      // Naht-Linie auf Körper
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(p.x + PIPE_W / 2 - 2, 0, 4, topH);

      // ── Unteres Rohr ─────────────────────────────────────
      ctx.fillStyle = grad;
      ctx.fillRect(p.x, botY, PIPE_W, botH);
      // Kappe
      ctx.fillStyle = '#0f4d22';
      ctx.fillRect(p.x - 5, botY, PIPE_W + 10, 24);
      ctx.fillStyle = 'rgba(100,255,140,0.22)';
      ctx.fillRect(p.x - 5, botY, PIPE_W + 10, 6);
      // Naht
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(p.x + PIPE_W / 2 - 2, botY, 4, botH);
    }
  }

  _drawHeli(ctx, x, y) {
    const tilt = Math.max(-0.42, Math.min(0.42, this._vy / 950));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // Schatten
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(2, 18, 30, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Heckausleger
    ctx.fillStyle = '#2050a0';
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-36, -6);
    ctx.lineTo(-36, 4);
    ctx.lineTo(-10, 5);
    ctx.closePath();
    ctx.fill();

    // Höhenruder
    ctx.fillStyle = '#163878';
    ctx.beginPath();
    ctx.moveTo(-34, -6);
    ctx.lineTo(-29, -16);
    ctx.lineTo(-22, -6);
    ctx.closePath();
    ctx.fill();

    // Rumpf
    const bodyGrad = ctx.createLinearGradient(-26, -13, -26, 14);
    bodyGrad.addColorStop(0, '#5ab8ff');
    bodyGrad.addColorStop(0.5, '#3a80e0');
    bodyGrad.addColorStop(1,   '#1e50b0');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 27, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Seitliche Zierakzente
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.ellipse(0, -5, 24, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cockpit-Blase
    const cockGrad = ctx.createLinearGradient(4, -13, 24, 8);
    cockGrad.addColorStop(0, '#d8f0ff');
    cockGrad.addColorStop(1, '#80c8ff');
    ctx.fillStyle = cockGrad;
    ctx.beginPath();
    ctx.ellipse(15, -1, 12, 10, 0.18, 0, Math.PI * 2);
    ctx.fill();

    // Cockpit-Glanz
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(13, -5, 5, 4, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Hecktriebwerk
    ctx.save();
    ctx.translate(-36, -1);
    ctx.rotate(this._rotorAngle * 3.8);
    ctx.strokeStyle = '#99aacc';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
      ctx.stroke();
    }
    ctx.restore();

    // Hauptrotor – Mast
    ctx.fillStyle = '#3a3a4a';
    ctx.fillRect(-2, -20, 4, 8);

    // Hauptrotor – Blätter als flache Ovale (Seitenansicht)
    // rx = volle Blattlänge, ry = ~3 px → foreshortened wie von der Seite gesehen
    const blade = (angle, alpha, len) => {
      ctx.save();
      ctx.translate(0, -20);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha;

      // Blatt-Körper: flaches Oval
      const g = ctx.createLinearGradient(0, -3, 0, 3);
      g.addColorStop(0,   '#5a5a72');
      g.addColorStop(0.45,'#3a3a50');
      g.addColorStop(1,   '#22222e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Glanzlinie auf der Vorderkante
      ctx.fillStyle = 'rgba(200,215,255,0.28)';
      ctx.beginPath();
      ctx.ellipse(2, -0.9, len * 0.72, 1.1, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.restore();
    };
    blade(this._rotorAngle,                  0.95, 38);
    blade(this._rotorAngle + Math.PI / 2,    0.70, 36);
    blade(this._rotorAngle + Math.PI,        0.88, 38);
    blade(this._rotorAngle + Math.PI * 1.5,  0.62, 36);

    // Kufen
    ctx.strokeStyle = '#555a70';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    // Linke Kufenstrebe
    ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(-16, 17); ctx.stroke();
    // Rechte Kufenstrebe
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(16, 17); ctx.stroke();
    // Kufenstange
    ctx.beginPath(); ctx.moveTo(-22, 17); ctx.lineTo(22, 17); ctx.stroke();
    // Vordere/hintere Kufenstreben
    ctx.beginPath(); ctx.moveTo(-4, 10); ctx.lineTo(-22, 17); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 10);  ctx.lineTo(22, 17);  ctx.stroke();

    ctx.restore();
  }

  _drawWait(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;

    // Titel-Panel
    ctx.fillStyle = 'rgba(5,15,40,0.88)';
    ctx.strokeStyle = '#1abc9c';
    ctx.lineWidth = 2;
    this._rrect(ctx, cx - 170, cy - 60, 340, 110, 14);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#1affd0';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🚁 Flappy Chopper', cx, cy - 22);

    ctx.fillStyle = '#ccddff';
    ctx.font = '17px Arial';
    ctx.fillText('Leertaste · ↑ · Klicken = Flap!', cx, cy + 12);

    ctx.fillStyle = '#667799';
    ctx.font = '13px Arial';
    ctx.fillText('ESC = Verlassen', cx, cy + 36);
  }

  _drawGameOver(ctx) {
    // Dunkles Overlay
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, H);

    const pw = 370, ph = 310;
    const px = (W - pw) / 2, py = (H - ph) / 2;

    // Panel
    ctx.fillStyle = 'rgba(4,8,28,0.97)';
    ctx.strokeStyle = '#2a5ccc';
    ctx.lineWidth = 2;
    this._rrect(ctx, px, py, pw, ph, 16);
    ctx.fill(); ctx.stroke();

    // Kopfzeile
    ctx.fillStyle = '#ff5555';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('💥 Game Over', W / 2, py + 40);

    // Punktzahl
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 21px Arial';
    ctx.fillText(`Punkte: ${this._score}`, W / 2, py + 75);

    // Bestenliste
    const hs = this._highscores;
    if (hs && hs.length > 0) {
      ctx.fillStyle = '#7799ee';
      ctx.font = 'bold 13px Arial';
      ctx.fillText('🏆 Bestenliste (Top 5)', W / 2, py + 108);

      const limit = Math.min(hs.length, 5);
      const medal = ['🥇', '🥈', '🥉'];

      for (let i = 0; i < limit; i++) {
        const e   = hs[i];
        const ey  = py + 128 + i * 22;
        const isNew = (e.score === this._score && e.name === this.playerName);

        ctx.fillStyle = isNew           ? '#55ff88'
                      : i === 0        ? '#ffd700'
                      : i === 1        ? '#c0c0c0'
                      : i === 2        ? '#cd7f32'
                      : '#aaaacc';
        ctx.font = (isNew || i < 3) ? 'bold 13px Arial' : '13px Arial';

        const rank = medal[i] || `${i + 1}.`;
        ctx.textAlign = 'left';
        ctx.fillText(`${rank}  ${e.name}`, px + 28, ey);
        ctx.textAlign = 'right';
        ctx.fillText(String(e.score), px + pw - 28, ey);
      }
    } else {
      ctx.fillStyle = '#445566';
      ctx.font = '13px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Lade Bestenliste…', W / 2, py + 130);
    }

    // Hinweis
    ctx.fillStyle = '#5577cc';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Leertaste · Klick = Nochmal', W / 2, py + ph - 42);
    ctx.fillStyle = '#334455';
    ctx.font = '12px Arial';
    ctx.fillText('ESC = Verlassen', W / 2, py + ph - 22);
  }

  // ── Hilfsmethoden ────────────────────────────────────────────
  /** Abgerundetes Rechteck (Pfad) */
  _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y,         x + r, y);
    ctx.closePath();
  }
}
