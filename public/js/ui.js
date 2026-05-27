// ─────────────────────────────────────────────────────────────
// Gesichts-Zeichenflaeche
// ─────────────────────────────────────────────────────────────
export function setupFaceCanvas() {
  const canvas       = document.getElementById('faceCanvas');
  const ctx          = canvas.getContext('2d');
  const hint         = document.getElementById('drawHint');
  const skinPicker   = document.getElementById('skinColorPicker');
  const shirtPicker  = document.getElementById('shirtColorPicker');

  let skinColor  = skinPicker  ? skinPicker.value  : '#ffce9e';
  let shirtColor = shirtPicker ? shirtPicker.value : '#5b9bd5';
  let drawing    = false;
  let tool      = 'pencil';
  let color     = '#1a1a1a';
  let size      = 8;
  let hasDrawn  = false;
  let lastX     = null;   // letzter Pinselkontaktpunkt (für durchgezogene Linien)
  let lastY     = null;

  // Off-Screen-Buffer: hält nur die Pinselstriche (transparenter Hintergrund)
  const buf    = document.createElement('canvas');
  buf.width    = canvas.width;
  buf.height   = canvas.height;
  const bufCtx = buf.getContext('2d');

  // Sichtbaren Canvas neu zusammensetzen: Hautfarbe als Hintergrund + Striche drüber
  const render = () => {
    ctx.fillStyle = skinColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buf, 0, 0);
  };
  render();

  // Nur die Zeichnung löschen (Hintergrundfarbe bleibt)
  const clearToSkin = () => {
    bufCtx.clearRect(0, 0, buf.width, buf.height);
    render();
    hint.classList.remove('gone');
    hasDrawn = false;
  };

  // Hautfarbe wechseln – Zeichnung bleibt erhalten
  const setSkin = (hex) => {
    skinColor = hex;
    if (skinPicker) skinPicker.value = hex;
    document.querySelectorAll('.swatch-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.color === hex));
    render();   // Hintergrund tauschen, Buffer unverändert
  };

  if (skinPicker) {
    skinPicker.addEventListener('input', e => setSkin(e.target.value));
  }
  document.querySelectorAll('.swatch-btn[data-color]').forEach(btn =>
    btn.addEventListener('click', () => setSkin(btn.dataset.color)));

  // Shirt-Farbe
  const setShirt = (hex) => {
    shirtColor = hex;
    if (shirtPicker) shirtPicker.value = hex;
    document.querySelectorAll('.swatch-btn[data-shirt]').forEach(b =>
      b.classList.toggle('active', b.dataset.shirt === hex));
  };
  if (shirtPicker) {
    shirtPicker.addEventListener('input', e => setShirt(e.target.value));
  }
  document.querySelectorAll('.swatch-btn[data-shirt]').forEach(btn =>
    btn.addEventListener('click', () => setShirt(btn.dataset.shirt)));

  // Koordinaten relativ zum Canvas (skaliert)
  const getPos = (e) => {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY
    };
  };

  // Hilfsfunktion: Punkt/Linie auf einen Canvas-Kontext zeichnen
  const _applyStroke = (c, x, y, col) => {
    c.lineCap    = 'round';
    c.lineJoin   = 'round';
    c.lineWidth  = size;
    c.strokeStyle = col;
    c.fillStyle   = col;
    if (lastX === null) {
      c.beginPath(); c.arc(x, y, size / 2, 0, Math.PI * 2); c.fill();
    } else {
      c.beginPath(); c.moveTo(lastX, lastY); c.lineTo(x, y); c.stroke();
    }
  };

  // Linie zeichnen – verbindet letzten mit aktuellem Punkt (smooth)
  const paint = (e) => {
    if (!drawing) return;
    if (e.cancelable) e.preventDefault();
    const { x, y } = getPos(e);

    if (tool === 'eraser') {
      // Radierer: Striche aus dem Buffer löschen → Hautfarbe scheint durch
      bufCtx.save();
      bufCtx.globalCompositeOperation = 'destination-out';
      _applyStroke(bufCtx, x, y, 'rgba(0,0,0,1)');
      bufCtx.restore();
    } else {
      // Stift: Strich in den Buffer malen
      _applyStroke(bufCtx, x, y, color);
    }

    render();   // Sichtbaren Canvas aktualisieren

    lastX = x;
    lastY = y;

    if (!hasDrawn) {
      hasDrawn = true;
      hint.classList.add('gone');
    }
  };

  const _stopDraw = () => { drawing = false; lastX = null; lastY = null; };

  // Maus
  canvas.addEventListener('mousedown',  e => { drawing = true; lastX = null; lastY = null; paint(e); });
  canvas.addEventListener('mousemove',  paint);
  canvas.addEventListener('mouseup',    _stopDraw);
  canvas.addEventListener('mouseleave', _stopDraw);

  // Touch
  canvas.addEventListener('touchstart', e => { drawing = true; lastX = null; lastY = null; paint(e); }, { passive: false });
  canvas.addEventListener('touchmove',  paint,                              { passive: false });
  canvas.addEventListener('touchend',   _stopDraw);

  // Farbe
  document.getElementById('colorPicker').addEventListener('input', e => {
    color = e.target.value;
    _setActiveTool('pencil');
  });

  // Groesse
  document.getElementById('brushSize').addEventListener('input', e => {
    size = parseInt(e.target.value);
  });

  // Stift
  document.getElementById('btnPencil').addEventListener('click', () => {
    tool = 'pencil';
    _setActiveTool('pencil');
  });

  // Radierer
  document.getElementById('btnEraser').addEventListener('click', () => {
    tool = 'eraser';
    _setActiveTool('eraser');
  });

  // Alles loeschen
  document.getElementById('btnClear').addEventListener('click', clearToSkin);

  return {
    /** Gibt die Zeichnung als base64-PNG zurueck */
    getDataURL:    () => canvas.toDataURL('image/png'),
    /** Gibt die gewaehlte Hautfarbe als Hex-String zurueck */
    getSkinColor:  () => skinColor,
    /** Gibt die gewaehlte T-Shirt-Farbe als Hex-String zurueck */
    getShirtColor: () => shirtColor
  };
}

// ─────────────────────────────────────────────────────────────
// Login-Screen
// ─────────────────────────────────────────────────────────────
/**
 * @param {(data: { name: string, faceData: string }) => void} onJoin
 */
export function setupLoginScreen(onJoin) {
  const faceCtrl  = setupFaceCanvas();
  const nameInput = document.getElementById('playerName');
  const joinBtn   = document.getElementById('joinBtn');

  const doJoin = () => {
    const name       = nameInput.value.trim() || 'Spieler';
    const faceData   = faceCtrl.getDataURL();
    const skinColor  = faceCtrl.getSkinColor();
    const shirtColor = faceCtrl.getShirtColor();
    onJoin({ name, faceData, skinColor, shirtColor });
  };

  joinBtn.addEventListener('click', doJoin);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoin();
  });
}

// ─────────────────────────────────────────────────────────────
// Login-Screen ausblenden, Spiel einblenden
// ─────────────────────────────────────────────────────────────
export function showGame() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('createBtn')?.classList.remove('hidden');  // optional: Element existiert nur falls vorhanden
}

// ─────────────────────────────────────────────────────────────
// Intern
// ─────────────────────────────────────────────────────────────
function _setActiveTool(name) {
  document.getElementById('btnPencil').classList.toggle('active', name === 'pencil');
  document.getElementById('btnEraser').classList.toggle('active', name === 'eraser');
}
