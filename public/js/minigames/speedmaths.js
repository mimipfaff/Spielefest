// ─────────────────────────────────────────────────────────────
// Speedmaths – Client-seitiges Minigame
// ─────────────────────────────────────────────────────────────
export class SpeedmathsGame {
  constructor(selfId, data, socket) {
    this.selfId  = selfId;
    this.socket  = socket;
    this.players = {};
    (data.players || []).forEach(p => {
      this.players[p.id] = { id: p.id, name: p.name, faceData: p.faceData || null, score: 0 };
    });

    this.round      = 0;
    this.totalRounds = 5;
    this.expr       = '';
    this.timeMs     = 15000;
    this._timerStart = 0;
    this._timerInt  = null;
    this._answered  = false;   // eigene Antwort in dieser Runde abgeschickt?
    this._shakeEnd  = 0;

    this._onKD = e => { if (e.key === 'Enter') this._submit(); };
  }

  // ── Lebenszyklus ───────────────────────────────────────────
  start() {
    this._buildDOM();
    this._bindSocket();
    window.addEventListener('keydown', this._onKD);
  }

  stop() {
    const ov = document.getElementById('minigameOverlay');
    if (ov) ov.classList.add('hidden');
    this._unbindSocket();
    window.removeEventListener('keydown', this._onKD);
    if (this._timerInt) clearInterval(this._timerInt);
  }

  // ── DOM ────────────────────────────────────────────────────
  _buildDOM() {
    const ov = document.getElementById('minigameOverlay');
    ov.innerHTML = '';
    ov.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100;',
      'background:#0a0a1a;display:flex;align-items:center;',
      'justify-content:center;flex-direction:column;gap:14px;'
    ].join('');

    // Titel
    const title = _el('div', 'color:#fff;font:bold 28px Arial;letter-spacing:3px;');
    title.textContent = '➕  Speedmaths';
    ov.appendChild(title);

    // Runden-Anzeige
    const roundEl = _el('div', 'color:#a0a0ff;font:16px Arial;');
    roundEl.id = 'smRound';
    roundEl.textContent = 'Warte auf erste Runde…';
    ov.appendChild(roundEl);

    // Aufgaben-Box
    const exprBox = _el('div',
      'background:#111133;border:2px solid #4a4aff;border-radius:12px;' +
      'padding:18px 40px;font:bold 52px Arial;color:#fff;' +
      'min-width:220px;text-align:center;letter-spacing:4px;');
    exprBox.id = 'smExpr';
    exprBox.textContent = '?';
    ov.appendChild(exprBox);

    // Timer-Balken
    const barWrap = _el('div',
      'width:340px;max-width:90vw;height:10px;background:#222;border-radius:5px;overflow:hidden;');
    const barFill = _el('div',
      'height:100%;background:#4a4aff;width:100%;transition:width .1s linear;');
    barFill.id = 'smBar';
    barWrap.appendChild(barFill);
    ov.appendChild(barWrap);

    // Eingabe-Zeile
    const inputRow = _el('div', 'display:flex;gap:10px;align-items:center;');
    const inp = document.createElement('input');
    inp.id = 'smInput';
    inp.type = 'number';
    inp.placeholder = 'Antwort…';
    inp.style.cssText = [
      'font:bold 28px Arial;padding:10px 16px;width:160px;text-align:center;',
      'background:#1a1a33;color:#fff;border:2px solid #555;border-radius:8px;',
      'outline:none;'
    ].join('');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') this._submit(); });

    const btn = document.createElement('button');
    btn.textContent = '✓ OK';
    btn.style.cssText = [
      'font:bold 20px Arial;padding:10px 22px;cursor:pointer;',
      'background:#4a4aff;color:#fff;border:none;border-radius:8px;'
    ].join('');
    btn.addEventListener('click', () => this._submit());
    inputRow.append(inp, btn);
    ov.appendChild(inputRow);

    // Feedback-Zeile (richtig/falsch-Anzeige)
    const fb = _el('div', 'font:16px Arial;color:#aaa;min-height:22px;');
    fb.id = 'smFeedback';
    ov.appendChild(fb);

    // Leaderboard
    const lb = _el('div',
      'background:#0d0d22;border:1px solid #2a2a60;border-radius:10px;' +
      'padding:10px 20px;min-width:280px;max-width:90vw;');
    lb.id = 'smLeaderboard';
    ov.appendChild(lb);
    this._renderLeaderboard();

    ov.classList.remove('hidden');
  }

  // ── Eingabe senden ─────────────────────────────────────────
  _submit() {
    if (this._answered) return;
    const inp = document.getElementById('smInput');
    if (!inp) return;
    const val = inp.value.trim();
    if (val === '' || isNaN(Number(val))) return;
    this._answered = true;
    inp.disabled = true;
    this.socket.emit('sm:answer', { value: parseInt(val, 10) });
  }

  // ── Timer-Balken ───────────────────────────────────────────
  _startTimerBar(ms) {
    if (this._timerInt) clearInterval(this._timerInt);
    this._timerStart = Date.now();
    this._timerInt = setInterval(() => {
      const bar = document.getElementById('smBar');
      if (!bar) return;
      const elapsed = Date.now() - this._timerStart;
      const pct = Math.max(0, 1 - elapsed / ms);
      bar.style.width = (pct * 100) + '%';
      bar.style.background = pct > 0.4 ? '#4a4aff' : (pct > 0.2 ? '#ff8800' : '#ff2222');
      if (pct <= 0) clearInterval(this._timerInt);
    }, 80);
  }

  // ── Leaderboard ────────────────────────────────────────────
  _renderLeaderboard() {
    const lb = document.getElementById('smLeaderboard');
    if (!lb) return;
    const sorted = Object.values(this.players).sort((a, b) => b.score - a.score);
    const medals = ['🥇', '🥈', '🥉'];
    lb.innerHTML = '';

    const title = _el('div', 'color:#a0a0ff;font:bold 13px Arial;text-align:center;margin-bottom:6px;');
    title.textContent = '— Punkte —';
    lb.appendChild(title);

    sorted.forEach((p, i) => {
      const row = _el('div',
        `display:flex;justify-content:space-between;align-items:center;` +
        `padding:3px 0;font:${p.id === this.selfId ? 'bold' : ''} 15px Arial;` +
        `color:${p.id === this.selfId ? '#ffff88' : '#ddd'};`);
      row.id = 'smRow_' + p.id;
      const left  = _el('span', '');
      left.textContent  = (medals[i] || (i + 1) + '.') + '  ' + p.name;
      const right = _el('span', 'font:bold 15px Arial;color:#4aff88;');
      right.textContent = p.score;
      row.append(left, right);
      lb.appendChild(row);
    });
  }

  // ── Flash wenn jemand richtig antwortet ────────────────────
  _flashPlayer(playerId) {
    const row = document.getElementById('smRow_' + playerId);
    if (!row) return;
    row.style.transition = 'background .15s';
    row.style.background = '#1a4a1a';
    setTimeout(() => { row.style.background = ''; }, 700);
  }

  // ── Socket ─────────────────────────────────────────────────
  _bindSocket() {
    this.socket.on('sm:question', ({ idx, total, expr, timeMs }) => {
      this.round     = idx + 1;
      this.expr      = expr;
      this._answered = false;
      this.timeMs    = timeMs;

      const roundEl = document.getElementById('smRound');
      if (roundEl) roundEl.textContent = `Runde ${this.round} / ${total}`;

      const exprEl = document.getElementById('smExpr');
      if (exprEl) exprEl.textContent = expr + ' = ?';

      const fb = document.getElementById('smFeedback');
      if (fb) fb.textContent = '';

      const inp = document.getElementById('smInput');
      if (inp) { inp.value = ''; inp.disabled = false; inp.focus(); }

      this._startTimerBar(timeMs);
      this._renderLeaderboard();
    });

    // Jemand hat richtig geantwortet → aufleuchten (Punkte erst nach Rundenende gesetzt)
    this.socket.on('sm:correct', ({ playerId, points }) => {
      this._flashPlayer(playerId);
      if (playerId === this.selfId) {
        const fb = document.getElementById('smFeedback');
        if (fb) { fb.textContent = '✅ Richtig! +' + points + ' Punkte'; fb.style.color = '#4aff88'; }
      }
    });

    // Eigene Antwort war falsch
    this.socket.on('sm:wrong', () => {
      this._answered = false;
      const inp = document.getElementById('smInput');
      if (inp) { inp.disabled = false; inp.focus(); }
      const fb = document.getElementById('smFeedback');
      if (fb) { fb.textContent = '❌ Falsch – nochmal!'; fb.style.color = '#ff6666'; }

      // Schüttel-Animation
      const exprEl = document.getElementById('smExpr');
      if (exprEl) {
        exprEl.style.animation = 'none';
        void exprEl.offsetWidth;
        exprEl.style.animation = 'smShake .35s ease';
      }
    });

    // Rundenende – Punkte vom Server setzen (autoritativ)
    this.socket.on('sm:roundResult', ({ answer, scores }) => {
      if (this._timerInt) clearInterval(this._timerInt);
      const bar = document.getElementById('smBar');
      if (bar) bar.style.width = '0%';

      // Punkte direkt übernehmen (Server ist autoritativ)
      if (scores) {
        Object.entries(scores).forEach(([id, pts]) => {
          if (this.players[id]) this.players[id].score = pts;
        });
      }
      this._renderLeaderboard();

      const fb = document.getElementById('smFeedback');
      if (fb) { fb.textContent = `Antwort war: ${answer}`; fb.style.color = '#ffcc44'; }

      const inp = document.getElementById('smInput');
      if (inp) inp.disabled = true;
    });

    // Endwertung
    this.socket.on('sm:final', ({ rankings }) => {
      if (this._timerInt) clearInterval(this._timerInt);
      this._showFinal(rankings);
    });

    this.socket.on('sm:done', () => {
      setTimeout(() => this.stop(), 800);
    });
  }

  _unbindSocket() {
    ['sm:question','sm:correct','sm:wrong','sm:roundResult','sm:final','sm:done']
      .forEach(e => this.socket.off(e));
  }

  // ── Final-Screen ───────────────────────────────────────────
  _showFinal(rankings) {
    const ov = document.getElementById('minigameOverlay');
    if (!ov) return;
    ov.innerHTML = '';
    ov.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100;',
      'background:#0a0a1a;display:flex;align-items:center;',
      'justify-content:center;flex-direction:column;gap:16px;'
    ].join('');

    const title = _el('div', 'color:#ffd700;font:bold 34px Arial;letter-spacing:2px;');
    title.textContent = '🏆 Ergebnis';
    ov.appendChild(title);

    const medals = ['🥇', '🥈', '🥉'];
    (rankings || []).forEach(({ id, name, score }, i) => {
      const row = _el('div',
        `font:${i === 0 ? 'bold 26px' : '20px'} Arial;` +
        `color:${id === this.selfId ? '#ffff88' : (i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : '#cd7f32')};`);
      row.textContent = `${medals[i] || (i + 1) + '.'}  ${name}  –  ${score} Punkte`;
      ov.appendChild(row);
    });

    const sub = _el('div', 'color:rgba(255,255,255,.4);font:14px Arial;margin-top:8px;');
    sub.textContent = 'Schließt in 6 Sekunden…';
    ov.appendChild(sub);
    setTimeout(() => this.stop(), 6000);
  }
}

// ── Shake-Keyframe (einmalig injizieren) ──────────────────────
if (!document.getElementById('smStyles')) {
  const s = document.createElement('style');
  s.id = 'smStyles';
  s.textContent = `@keyframes smShake {
    0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)}
    40%{transform:translateX(8px)}   60%{transform:translateX(-6px)}
    80%{transform:translateX(6px)}
  }`;
  document.head.appendChild(s);
}

function _el(tag, css = '') {
  const e = document.createElement(tag);
  e.style.cssText = css;
  return e;
}
