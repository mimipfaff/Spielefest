// ─────────────────────────────────────────────────────────────
// Facepaint – Client-seitiges Minigame
// ─────────────────────────────────────────────────────────────
export class FacepaintGame {
  constructor(selfId, data, socket) {
    this.selfId     = selfId;
    this.socket     = socket;
    this.p1         = data.p1;
    this.p2         = data.p2;
    this.p1Name     = data.p1Name;
    this.p2Name     = data.p2Name;
    this.p1Face     = data.p1Face;
    this.p2Face     = data.p2Face;
    this.spectators = data.spectators || [];

    // Runden-State (wird bei fp:roundStart gesetzt)
    this.isPainter    = false;
    this.isSubject    = false;
    this.painter      = null;
    this.subject      = null;
    this.round        = 0;
    this.timerLeft    = 30;
    this._timerInt    = null;

    // Zeichen-State
    this.isDrawing      = false;
    this.color          = '#222222';
    this.brush          = 16;
    this.tool           = 'pencil';
    this._lastPt        = null;

    // Canvas-Referenzen
    this.drawCanvas = null;
    this.drawCtx    = null;
    this.viewCanvas = null;
    this.viewCtx    = null;

    // Event-Handler (gebunden für späteres removeEventListener)
    this._onPD = e => this._pointerDown(e);
    this._onPM = e => this._pointerMove(e);
    this._onPU = () => { this.isDrawing = false; this._lastPt = null; };
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
    if (this.drawCanvas) {
      this.drawCanvas.removeEventListener('mousedown',  this._onPD);
      this.drawCanvas.removeEventListener('mousemove',  this._onPM);
      this.drawCanvas.removeEventListener('mouseup',    this._onPU);
      this.drawCanvas.removeEventListener('mouseleave', this._onPU);
    }
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
    const title = document.createElement('div');
    title.textContent = '🎨  Facepaint';
    title.style.cssText = 'color:#fff;font:bold 28px Arial;letter-spacing:3px;';
    ov.appendChild(title);

    // Status-Zeile
    const status = document.createElement('div');
    status.id = 'fpStatus';
    status.style.cssText = 'color:#a0a0ff;font:18px Arial;text-align:center;min-height:26px;';
    status.textContent = 'Warte auf Rundenstart…';
    ov.appendChild(status);

    // Haupt-Bereich (zwei Canvases nebeneinander)
    const main = document.createElement('div');
    main.style.cssText = 'display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;justify-content:center;';
    ov.appendChild(main);

    const SIZE = Math.min(Math.floor((window.innerWidth - 80) / 2), 260, window.innerHeight - 220);

    // ── Zeichnen-Seite ──
    const drawWrap = document.createElement('div');
    drawWrap.id = 'fpDrawWrap';
    drawWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';

    const drawLabel = document.createElement('div');
    drawLabel.id = 'fpDrawLabel';
    drawLabel.style.cssText = 'color:#ccc;font:14px Arial;';
    drawLabel.textContent = 'Deine Leinwand';
    drawWrap.appendChild(drawLabel);

    const drawC = document.createElement('canvas');
    drawC.width = drawC.height = 256;
    drawC.style.cssText = `width:${SIZE}px;height:${SIZE}px;cursor:crosshair;` +
      'border:3px solid #4a4aff;border-radius:50%;touch-action:none;';
    this.drawCanvas = drawC;
    this.drawCtx    = drawC.getContext('2d');
    this._fillCanvas(this.drawCtx);
    drawWrap.appendChild(drawC);

    // Werkzeuge
    const tools = document.createElement('div');
    tools.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;';

    const colorIn = document.createElement('input');
    colorIn.type = 'color'; colorIn.value = '#222222';
    colorIn.style.cssText = 'width:36px;height:36px;cursor:pointer;border:none;padding:0;';

    const brushIn = document.createElement('input');
    brushIn.type = 'range'; brushIn.min = 3; brushIn.max = 40; brushIn.value = 16;
    brushIn.style.cssText = 'width:80px;';
    brushIn.addEventListener('input', e => { this.brush = +e.target.value; });

    const makeBtn = (label, action, id) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (id) b.id = id;
      b.style.cssText = 'padding:6px 12px;cursor:pointer;border-radius:6px;' +
        'border:1px solid #555;background:#222;color:#fff;font:14px Arial;transition:background .15s;';
      b.addEventListener('click', action);
      return b;
    };

    const setTool = (tool) => {
      this.tool = tool;
      const pencilBtn = document.getElementById('fpBtnPencil');
      const eraserBtn = document.getElementById('fpBtnEraser');
      if (pencilBtn) pencilBtn.style.background = tool === 'pencil' ? '#4a4aff' : '#222';
      if (eraserBtn) eraserBtn.style.background = tool === 'eraser' ? '#4a4aff' : '#222';
    };

    // Farbwähler → automatisch Stift aktivieren
    colorIn.addEventListener('input', e => { this.color = e.target.value; setTool('pencil'); });
    colorIn.addEventListener('click',       () => setTool('pencil'));

    tools.append(
      colorIn, brushIn,
      makeBtn('✏️ Stift',    () => setTool('pencil'),  'fpBtnPencil'),
      makeBtn('⬜ Radierer', () => setTool('eraser'),  'fpBtnEraser'),
      makeBtn('🗑 Löschen',  () => { this._fillCanvas(this.drawCtx); this._fillCanvas(this.viewCtx); })
    );
    // Stift initial hervorheben
    requestAnimationFrame(() => setTool('pencil'));
    drawWrap.appendChild(tools);
    main.appendChild(drawWrap);

    // ── Vorschau-Seite ──
    const viewWrap = document.createElement('div');
    viewWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';

    const viewLabel = document.createElement('div');
    viewLabel.id = 'fpViewLabel';
    viewLabel.style.cssText = 'color:#ccc;font:14px Arial;';
    viewLabel.textContent = 'Live-Vorschau';
    viewWrap.appendChild(viewLabel);

    const viewC = document.createElement('canvas');
    viewC.width = viewC.height = 256;
    viewC.style.cssText = `width:${SIZE}px;height:${SIZE}px;` +
      'border:3px solid #2a7a2a;border-radius:50%;';
    this.viewCanvas = viewC;
    this.viewCtx    = viewC.getContext('2d');
    this._fillCanvas(this.viewCtx);
    viewWrap.appendChild(viewC);

    // Timer
    const timerEl = document.createElement('div');
    timerEl.id = 'fpTimer';
    timerEl.style.cssText = 'color:#ff6600;font:bold 40px Arial;min-width:64px;text-align:center;';
    timerEl.textContent = '30';
    viewWrap.appendChild(timerEl);
    main.appendChild(viewWrap);

    ov.classList.remove('hidden');

    // Zeichnen-Events
    drawC.addEventListener('mousedown',  this._onPD);
    drawC.addEventListener('mousemove',  this._onPM);
    drawC.addEventListener('mouseup',    this._onPU);
    drawC.addEventListener('mouseleave', this._onPU);
    drawC.addEventListener('touchstart', e => { e.preventDefault(); this._pointerDown(e.touches[0]); }, { passive: false });
    drawC.addEventListener('touchmove',  e => { e.preventDefault(); this._pointerMove(e.touches[0]); }, { passive: false });
    drawC.addEventListener('touchend',   this._onPU);
  }

  // ── Zeichnen ───────────────────────────────────────────────
  _fillCanvas(ctx, color = '#ffce9e') {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(128, 128, 128, 0, Math.PI * 2); ctx.fill();
  }

  _pointerDown(e) {
    if (!this.isPainter || !this.drawCanvas) return;
    this.isDrawing = true;
    const p = this._getPos(e);
    this._stroke(p, p);
    this._lastPt = p;
  }

  _pointerMove(e) {
    if (!this.isDrawing || !this.isPainter) return;
    const p    = this._getPos(e);
    const prev = this._lastPt || p;
    this._stroke(prev, p);
    this._lastPt = p;
  }

  _getPos(e) {
    const r = this.drawCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * 256 / r.width,
      y: (e.clientY - r.top)  * 256 / r.height
    };
  }

  _stroke(from, to) {
    const fill = this.tool === 'eraser' ? '#ffce9e' : this.color;
    const r    = this.brush / 2;
    this._applyStroke(this.drawCtx, from, to, fill, r);
    this._applyStroke(this.viewCtx, from, to, fill, r);
    this.socket.emit('fp:stroke', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: fill, r });
  }

  _applyStroke(ctx, from, to, color, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(128, 128, 127, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = r * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(from.x, from.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(to.x,   to.y,   r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  _loadFaceToCanvas(ctx, faceData) {
    this._fillCanvas(ctx);
    if (!faceData) return;
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.beginPath(); ctx.arc(128, 128, 128, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, 0, 0, 256, 256);
      ctx.restore();
    };
    img.src = faceData;
  }

  // ── Socket ─────────────────────────────────────────────────
  _bindSocket() {
    this.socket.on('fp:roundStart', data => {
      this.round     = data.round;
      this.painter   = data.painter;
      this.subject   = data.subject;
      this.isPainter = data.painter === this.selfId;
      this.isSubject = data.subject === this.selfId;
      this.timerLeft = 30;

      // Gesicht des Subjekts als Startbild laden
      this._loadFaceToCanvas(this.drawCtx, data.subjectFace);
      this._loadFaceToCanvas(this.viewCtx, data.subjectFace);

      // Status-Text
      const statusEl = document.getElementById('fpStatus');
      if (statusEl) {
        if (this.isPainter)
          statusEl.textContent = `🎨 Du malst ${data.subjectName} ein neues Gesicht!`;
        else if (this.isSubject)
          statusEl.textContent = `😮 ${data.painterName} malt dein Gesicht um!`;
        else
          statusEl.textContent = `${data.painterName} malt ${data.subjectName}`;
      }

      // Zeichenbereich anzeigen/verbergen
      const dw = document.getElementById('fpDrawWrap');
      if (dw) dw.style.display = this.isPainter ? 'flex' : 'none';

      // Label aktualisieren
      const drawLabel = document.getElementById('fpDrawLabel');
      if (drawLabel) drawLabel.textContent = this.isPainter ? `Gesicht von ${data.subjectName}` : 'Dein Gesicht';

      // Timer starten
      if (this._timerInt) clearInterval(this._timerInt);
      this._timerInt = setInterval(() => {
        this.timerLeft = Math.max(0, this.timerLeft - 1);
        const t = document.getElementById('fpTimer');
        if (t) {
          t.textContent  = this.timerLeft;
          t.style.color  = this.timerLeft <= 10 ? '#ff2222' : '#ff6600';
        }
        if (this.timerLeft <= 0) clearInterval(this._timerInt);
      }, 1000);
    });

    this.socket.on('fp:stroke', ({ x1, y1, x2, y2, color, r }) => {
      // Eingehende Striche vom Maler → auf Vorschau + eigene Leinwand (falls Subjekt)
      this._applyStroke(this.viewCtx, { x: x1, y: y1 }, { x: x2, y: y2 }, color, r);
      if (!this.isPainter) {
        this._applyStroke(this.drawCtx, { x: x1, y: y1 }, { x: x2, y: y2 }, color, r);
      }
    });

    this.socket.on('fp:roundEnd', ({ round }) => {
      if (this._timerInt) clearInterval(this._timerInt);
      // Maler schickt das fertige Gesicht
      if (this.isPainter && this.drawCanvas) {
        const faceData = this.drawCanvas.toDataURL('image/png');
        this.socket.emit('fp:faceComplete', { faceData });
      }
      const statusEl = document.getElementById('fpStatus');
      if (statusEl) {
        statusEl.textContent = round === 1
          ? '⏱ Runde 1 fertig! Runde 2 beginnt gleich…'
          : '⏱ Beide Runden fertig!';
      }
    });

    this.socket.on('fp:faceUpdate', ({ playerId, faceData }) => {
      // Zeige das neue Gesicht in der Vorschau
      this._loadFaceToCanvas(this.viewCtx, faceData);
    });

    this.socket.on('fp:done', () => {
      if (this._timerInt) clearInterval(this._timerInt);
      const statusEl = document.getElementById('fpStatus');
      if (statusEl) statusEl.textContent = '🎉 Fertig!';
      setTimeout(() => this.stop(), 800);
    });
  }

  _unbindSocket() {
    ['fp:roundStart','fp:stroke','fp:roundEnd','fp:faceUpdate','fp:done'].forEach(e => this.socket.off(e));
  }
}
