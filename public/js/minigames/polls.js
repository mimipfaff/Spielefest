// ─────────────────────────────────────────────────────────────
// Polls – Client-seitiges Minigame  (Stand 3)
// ─────────────────────────────────────────────────────────────
export class PollsGame {
  constructor(selfId, data, socket) {
    this.selfId     = selfId;
    this.socket     = socket;
    this.players    = data.players || [];   // [{ id, name, faceData }]

    // Phase-State
    this.phase        = 'waiting';
    this.timerLeft    = 0;
    this._timerInt    = null;
    this._hasAsked    = false;
    this._myVote      = null;   // ID des Spielers den ich gewählt habe
  }

  // ── Lebenszyklus ───────────────────────────────────────────
  start() {
    this._buildDOM();
    this._bindSocket();
  }

  stop() {
    const ov = document.getElementById('minigameOverlay');
    if (ov) ov.classList.add('hidden');
    this._unbindSocket();
    if (this._timerInt) clearInterval(this._timerInt);
  }

  // ── DOM ────────────────────────────────────────────────────
  _buildDOM() {
    const ov = document.getElementById('minigameOverlay');
    ov.innerHTML = '';
    ov.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100;',
      'background:#0d0d1f;display:flex;align-items:center;',
      'justify-content:center;flex-direction:column;gap:16px;',
      'font-family:Arial,sans-serif;'
    ].join('');

    // Titel
    const title = document.createElement('div');
    title.textContent = '🗳  Polls';
    title.style.cssText = 'color:#fff;font:bold 30px Arial;letter-spacing:3px;';
    ov.appendChild(title);

    // Timer-Balken
    const timerWrap = document.createElement('div');
    timerWrap.style.cssText = 'width:min(500px,80vw);background:#222;border-radius:6px;overflow:hidden;height:10px;';
    const timerBar = document.createElement('div');
    timerBar.id = 'poTimerBar';
    timerBar.style.cssText = 'height:100%;background:#4a4aff;width:100%;transition:width 1s linear;';
    timerWrap.appendChild(timerBar);
    ov.appendChild(timerWrap);

    // Timer-Zahl
    const timerNum = document.createElement('div');
    timerNum.id = 'poTimerNum';
    timerNum.style.cssText = 'color:#888;font:14px Arial;';
    timerNum.textContent = '';
    ov.appendChild(timerNum);

    // Haupt-Karte
    const card = document.createElement('div');
    card.id = 'poCard';
    card.style.cssText = [
      'background:#161630;border:1px solid #333;border-radius:14px;',
      'padding:24px 28px;width:min(540px,88vw);',
      'display:flex;flex-direction:column;gap:16px;align-items:center;'
    ].join('');
    ov.appendChild(card);

    // Initiale Wartenachricht
    this._showWaiting(card);

    ov.classList.remove('hidden');
  }

  // ── Phasen-Anzeigen ────────────────────────────────────────

  _showWaiting(card) {
    card = card || document.getElementById('poCard');
    if (!card) return;
    card.innerHTML = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#a0a0ff;font:18px Arial;text-align:center;';
    msg.textContent = 'Spiel startet gleich…';
    card.appendChild(msg);
  }

  _showCollect(durationSec) {
    const card = document.getElementById('poCard');
    if (!card) return;
    card.innerHTML = '';
    this._hasAsked = false;

    const heading = document.createElement('div');
    heading.style.cssText = 'color:#fff;font:bold 20px Arial;text-align:center;';
    heading.textContent = '✍️  Schreibe eine Frage!';
    card.appendChild(heading);

    const sub = document.createElement('div');
    sub.style.cssText = 'color:#888;font:13px Arial;text-align:center;';
    sub.textContent = 'z. B. „Wer würde am ehesten …"';
    card.appendChild(sub);

    const textarea = document.createElement('textarea');
    textarea.id = 'poQuestionInput';
    textarea.maxLength = 140;
    textarea.placeholder = 'Deine Frage hier…';
    textarea.style.cssText = [
      'width:100%;box-sizing:border-box;resize:none;height:80px;',
      'background:#0d0d1f;color:#fff;border:2px solid #4a4aff;border-radius:8px;',
      'padding:10px 12px;font:16px Arial;outline:none;'
    ].join('');
    card.appendChild(textarea);

    const charCount = document.createElement('div');
    charCount.style.cssText = 'color:#555;font:12px Arial;align-self:flex-end;';
    charCount.textContent = '0 / 140';
    card.appendChild(charCount);
    textarea.addEventListener('input', () => {
      charCount.textContent = `${textarea.value.length} / 140`;
    });

    const ackMsg = document.createElement('div');
    ackMsg.id = 'poAckMsg';
    ackMsg.style.cssText = 'color:#4aff4a;font:14px Arial;min-height:20px;text-align:center;';
    card.appendChild(ackMsg);

    const collectProg = document.createElement('div');
    collectProg.id = 'poCollectProg';
    collectProg.style.cssText = 'color:#666;font:13px Arial;text-align:center;';
    collectProg.textContent = `0 / ${this.players.length} haben abgeschickt`;
    card.appendChild(collectProg);

    const submitBtn = document.createElement('button');
    submitBtn.id = 'poSubmitBtn';
    submitBtn.textContent = 'Frage einreichen ✓';
    submitBtn.style.cssText = [
      'padding:10px 28px;font:bold 16px Arial;border-radius:8px;',
      'background:#4a4aff;color:#fff;border:none;cursor:pointer;'
    ].join('');
    submitBtn.addEventListener('click', () => {
      if (this._hasAsked) return;
      const q = textarea.value.trim();
      if (!q) return;
      this._hasAsked = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '✓ Eingereicht!';
      submitBtn.style.background = '#2a7a2a';
      textarea.disabled = true;
      // Server erwartet { text: '...' }
      this.socket.emit('po:submitQuestion', { text: q });
    });
    card.appendChild(submitBtn);

    // Bestätigung vom Server
    this.socket.once('po:questionAck', () => {
      const ack = document.getElementById('poAckMsg');
      if (ack) ack.textContent = '✓ Frage gespeichert!';
    });

    this._startTimer(durationSec, '#4a4aff');
  }

  _showQuestion(data) {
    // data: { idx, total, text, author (socketId), timeMs }
    const card = document.getElementById('poCard');
    if (!card) return;
    card.innerHTML = '';
    this._myVote = null;

    // Header
    const askerPlayer = this.players.find(p => p.id === data.author);
    const askerName   = askerPlayer ? askerPlayer.name : '?';

    const info = document.createElement('div');
    info.style.cssText = 'color:#888;font:13px Arial;text-align:center;';
    info.textContent   = `Frage ${data.idx + 1} / ${data.total}  ·  von ${askerName}`;
    card.appendChild(info);

    const q = document.createElement('div');
    q.style.cssText = [
      'color:#fff;font:bold 20px Arial;text-align:center;',
      'background:#1e1e40;padding:16px 18px;border-radius:10px;width:100%;box-sizing:border-box;'
    ].join('');
    q.textContent = `"${data.text}"`;
    card.appendChild(q);

    const hint = document.createElement('div');
    hint.style.cssText = 'color:#a0a0ff;font:14px Arial;text-align:center;';
    hint.textContent   = 'Tippe auf eine Person:';
    card.appendChild(hint);

    // Spieler-Grid
    const grid = document.createElement('div');
    grid.id = 'poPlayerGrid';
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;width:100%;';

    for (const p of this.players) {
      const btn = document.createElement('button');
      btn.id             = `poPlayer_${p.id}`;
      btn.dataset.playerId = p.id;
      btn.style.cssText  = [
        'display:flex;flex-direction:column;align-items:center;gap:6px;',
        'background:#1e1e40;border:2px solid #333;border-radius:10px;',
        'padding:10px 14px;cursor:pointer;min-width:80px;',
        'transition:border-color .15s,background .15s;'
      ].join('');
      btn.addEventListener('mouseenter', () => {
        if (this._myVote !== p.id) btn.style.borderColor = '#4a4aff';
      });
      btn.addEventListener('mouseleave', () => {
        if (this._myVote !== p.id) btn.style.borderColor = '#333';
        else btn.style.borderColor = '#4aff4a';
      });
      btn.addEventListener('click', () => {
        // Vorherige Wahl zurücksetzen
        if (this._myVote) {
          const prev = document.getElementById(`poPlayer_${this._myVote}`);
          if (prev) { prev.style.borderColor = '#333'; prev.style.background = '#1e1e40'; }
        }
        this._myVote = p.id;
        this.socket.emit('po:vote', { targetId: p.id });
        btn.style.borderColor = '#4aff4a';
        btn.style.background  = '#1a3a1a';
      });

      // Gesicht
      const face = document.createElement('canvas');
      face.width = face.height = 64;
      face.style.cssText = 'border-radius:50%;border:2px solid #555;';
      this._drawFaceOnCanvas(face, p.faceData);
      btn.appendChild(face);

      // Name
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'color:#ccc;font:12px Arial;text-align:center;word-break:break-word;max-width:80px;';
      nameEl.textContent   = p.name;
      btn.appendChild(nameEl);

      grid.appendChild(btn);
    }
    card.appendChild(grid);

    // Vote-Fortschritt (nur Anzahl, keine Namen)
    const voteProg = document.createElement('div');
    voteProg.id = 'poVoteProg';
    voteProg.style.cssText = 'color:#888;font:13px Arial;text-align:center;';
    voteProg.textContent = `0 / ${this.players.length} haben abgestimmt`;
    card.appendChild(voteProg);

    const durationSec = Math.round((data.timeMs || 15000) / 1000);
    this._startTimer(durationSec, '#ff9900');
  }

  _handleVoteAck({ targetId }) {
    // Eigene Auswahl bestätigen — Button bereits durch click-handler markiert
    this._myVote = targetId;
  }

  _handleVoteProgress({ voted, total }) {
    const el = document.getElementById('poVoteProg');
    if (el) {
      el.textContent = `${voted} / ${total} haben abgestimmt`;
      el.style.color = voted >= total ? '#4aff4a' : '#888';
    }
  }

  _handleCollectProgress({ submitted, total }) {
    const el = document.getElementById('poCollectProg');
    if (el) {
      el.textContent = `${submitted} / ${total} haben abgeschickt`;
      el.style.color = submitted >= total ? '#4aff4a' : '#666';
    }
  }

  _showRoundResult(data) {
    // data: { idx, total, text, results: [{id, votes, name}], voteMap }
    const card = document.getElementById('poCard');
    if (!card) return;
    if (this._timerInt) clearInterval(this._timerInt);
    this.phase = 'result';

    card.innerHTML = '';

    const heading = document.createElement('div');
    heading.style.cssText = 'color:#fff;font:bold 18px Arial;text-align:center;';
    heading.textContent = '📊 Ergebnis';
    card.appendChild(heading);

    const qEl = document.createElement('div');
    qEl.style.cssText = 'color:#a0a0ff;font:15px Arial;text-align:center;font-style:italic;';
    qEl.textContent   = `"${data.text}"`;
    card.appendChild(qEl);

    const medals  = ['🥇', '🥈', '🥉'];
    const top     = (data.results || []).slice(0, 3);
    for (let i = 0; i < top.length; i++) {
      if (top[i].votes === 0) break;   // Keine Stimmen = nicht anzeigen
      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex;align-items:center;gap:12px;',
        'background:#1e1e40;padding:10px 16px;border-radius:8px;width:100%;box-sizing:border-box;'
      ].join('');

      const medal = document.createElement('span');
      medal.style.cssText = 'font:22px serif;';
      medal.textContent   = medals[i] || `${i + 1}.`;
      row.appendChild(medal);

      const face = document.createElement('canvas');
      face.width = face.height = 44;
      face.style.cssText = 'border-radius:50%;border:2px solid #555;flex-shrink:0;';
      const p = this.players.find(x => x.id === top[i].id);
      this._drawFaceOnCanvas(face, p ? p.faceData : null);
      row.appendChild(face);

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'color:#fff;font:bold 16px Arial;flex:1;';
      nameEl.textContent   = top[i].name;
      row.appendChild(nameEl);

      const cnt = document.createElement('div');
      cnt.style.cssText = 'color:#4a4aff;font:bold 18px Arial;';
      cnt.textContent   = `${top[i].votes} Stimme${top[i].votes !== 1 ? 'n' : ''}`;
      row.appendChild(cnt);

      card.appendChild(row);
    }

    if (data.idx + 1 < data.total) {
      const next = document.createElement('div');
      next.style.cssText = 'color:#666;font:13px Arial;text-align:center;';
      next.textContent   = 'Nächste Frage in 6s…';
      card.appendChild(next);
    }
  }

  _showFinal(data) {
    // data: { rankings: [{id, votes, name}] }
    const card = document.getElementById('poCard');
    if (!card) return;
    if (this._timerInt) clearInterval(this._timerInt);
    this.phase = 'final';

    card.innerHTML = '';

    const heading = document.createElement('div');
    heading.style.cssText = 'color:#fff;font:bold 22px Arial;text-align:center;letter-spacing:2px;';
    heading.textContent = '🏆 Gesamtergebnis';
    card.appendChild(heading);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:100%;';

    const medals   = ['🥇', '🥈', '🥉'];
    const rankings = data.rankings || [];

    for (let i = 0; i < rankings.length; i++) {
      const r      = rankings[i];
      const isSelf = r.id === this.selfId;
      const row    = document.createElement('div');
      row.style.cssText = [
        'display:flex;align-items:center;gap:10px;',
        'padding:8px 14px;border-radius:8px;',
        isSelf
          ? 'background:#1a2a1a;border:2px solid #4aff4a;'
          : 'background:#1e1e40;border:1px solid #333;'
      ].join('');

      const rank = document.createElement('div');
      rank.style.cssText = 'font:18px serif;min-width:28px;text-align:center;';
      rank.textContent   = medals[i] || `${i + 1}.`;
      row.appendChild(rank);

      const face = document.createElement('canvas');
      face.width = face.height = 40;
      face.style.cssText = 'border-radius:50%;border:2px solid #555;flex-shrink:0;';
      const p = this.players.find(x => x.id === r.id);
      this._drawFaceOnCanvas(face, p ? p.faceData : null);
      row.appendChild(face);

      const nameEl = document.createElement('div');
      nameEl.style.cssText = `color:${isSelf ? '#4aff4a' : '#ccc'};font:${isSelf ? 'bold ' : ''}15px Arial;flex:1;`;
      nameEl.textContent   = r.name + (isSelf ? ' (Du)' : '');
      row.appendChild(nameEl);

      const cnt = document.createElement('div');
      cnt.style.cssText = 'color:#a0a0ff;font:bold 15px Arial;';
      cnt.textContent   = `${r.votes} Stimme${r.votes !== 1 ? 'n' : ''}`;
      row.appendChild(cnt);

      list.appendChild(row);
    }
    card.appendChild(list);

    const closing = document.createElement('div');
    closing.style.cssText = 'color:#555;font:13px Arial;text-align:center;';
    closing.textContent = 'Schließt in 10s…';
    card.appendChild(closing);

    setTimeout(() => this.stop(), 10000);
  }

  _showAborted(msg) {
    const card = document.getElementById('poCard');
    if (!card) return;
    if (this._timerInt) clearInterval(this._timerInt);
    card.innerHTML = '';
    const el = document.createElement('div');
    el.style.cssText = 'color:#ff4444;font:16px Arial;text-align:center;';
    el.textContent   = msg || 'Spiel abgebrochen.';
    card.appendChild(el);
    setTimeout(() => this.stop(), 4000);
  }

  // ── Gesicht auf Mini-Canvas ─────────────────────────────────
  _drawFaceOnCanvas(canvas, faceData) {
    const ctx = canvas.getContext('2d');
    const s   = canvas.width;
    ctx.fillStyle = '#ffce9e';
    ctx.beginPath(); ctx.arc(s/2, s/2, s/2, 0, Math.PI*2); ctx.fill();
    if (!faceData) return;
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.beginPath(); ctx.arc(s/2, s/2, s/2, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(img, 0, 0, s, s);
      ctx.restore();
    };
    img.src = faceData;
  }

  // ── Timer ──────────────────────────────────────────────────
  _startTimer(durationSec, barColor) {
    if (this._timerInt) clearInterval(this._timerInt);
    this.timerLeft = durationSec;

    const bar = document.getElementById('poTimerBar');
    const num = document.getElementById('poTimerNum');
    if (bar) { bar.style.background = barColor; bar.style.transition = 'none'; bar.style.width = '100%'; }
    if (num) num.textContent = `${durationSec}s`;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (bar) { bar.style.transition = `width ${durationSec}s linear`; bar.style.width = '0%'; }
    }));

    this._timerInt = setInterval(() => {
      this.timerLeft = Math.max(0, this.timerLeft - 1);
      if (num) {
        num.textContent = `${this.timerLeft}s`;
        num.style.color = this.timerLeft <= 5 ? '#ff4444' : '#888';
      }
      if (this.timerLeft <= 0) clearInterval(this._timerInt);
    }, 1000);
  }

  // ── Socket ─────────────────────────────────────────────────
  _bindSocket() {
    // Phase 1: Fragesammlung
    // Server schickt { timeMs: 30000 }
    this.socket.on('po:collect', data => {
      this.phase = 'collect';
      this._showCollect(Math.round((data.timeMs || 30000) / 1000));
    });

    // Phase 2: Abstimmung
    // Server schickt { idx, total, text, author, timeMs }
    this.socket.on('po:question', data => {
      this.phase = 'voting';
      this._showQuestion(data);
    });

    // Eigene Wahl bestätigt (nur an den Voter geschickt)
    this.socket.on('po:voteAck', data => {
      this._handleVoteAck(data);
    });

    // Abstimmungsfortschritt (Anzahl, keine Namen)
    this.socket.on('po:voteProgress', data => {
      this._handleVoteProgress(data);
    });

    // Fragensammlungs-Fortschritt
    this.socket.on('po:collectProgress', data => {
      this._handleCollectProgress(data);
    });

    // Rundenresultat
    // Server schickt { idx, total, text, results: [{id, votes, name}], voteMap }
    this.socket.on('po:roundResult', data => {
      this._showRoundResult(data);
    });

    // Gesamtergebnis
    // Server schickt { rankings: [{id, votes, name}] }
    this.socket.on('po:final', data => {
      this._showFinal(data);
    });

    // Abbruch
    this.socket.on('po:aborted', () => {
      this._showAborted('Ein Spieler hat das Spiel verlassen.');
    });

    // Fehler – Server schickt { msg }
    this.socket.on('po:error', ({ msg }) => {
      this._showAborted(msg || 'Fehler aufgetreten.');
    });
  }

  _unbindSocket() {
    ['po:collect','po:question','po:voteAck','po:voteProgress','po:collectProgress',
     'po:roundResult','po:final','po:aborted','po:error','po:questionAck']
      .forEach(e => this.socket.off(e));
  }
}
