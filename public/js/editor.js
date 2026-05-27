import * as THREE from 'three';

// BoxGeometry-Materialreihenfolge: +x, -x, +y, -y, +z(vorne), -z(hinten)
const FACE_MAT_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back'];
const FACE_DE = { front:'Vorne', back:'Hinten', left:'Links', right:'Rechts', top:'Oben', bottom:'Unten' };

// ─────────────────────────────────────────────────────────────
export class ObjectEditor {
  /**
   * @param {(data: ObjectData) => void} onActivate
   *   ObjectData = { faceTextures, faceCanvases, width, height, depth }
   */
  constructor(onActivate) {
    this.onActivate = onActivate;

    // Offscreen-Canvas fuer jede Seite (128 × 128 px)
    this.faceCanvases = {};
    FACE_MAT_ORDER.forEach(f => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 128, 128);
      this.faceCanvases[f] = c;
    });

    this.currentFace = 'front';
    this.size  = { w: 2, h: 2, d: 1 };
    this.tool  = 'pencil';
    this.color = '#222222';
    this.brush = 12;
    this.isDrawing = false;

    this._prevAnim   = null;
    this._prevMesh   = null;
    this._prevScene  = null;
    this._prevCam    = null;
    this._prevRend   = null;

    this._buildDOM();
    this._bindEvents();
    this._initPreview();
  }

  // ── Oeffnen / Schliessen ──────────────────────────────────
  open() {
    this._el('editorOverlay').classList.remove('hidden');
    this._loadFaceToCanvas(this.currentFace);
    this._refreshThumbnails();
    this._startPreview();
  }

  close() {
    this._el('editorOverlay').classList.add('hidden');
    this._stopPreview();
  }

  /** Gibt data-URLs aller 6 Seiten zurueck (fuer Netzwerk-Sync). */
  getFaceTextures() {
    const r = {};
    FACE_MAT_ORDER.forEach(f => {
      r[f] = this.faceCanvases[f].toDataURL('image/png');
    });
    return r;
  }

  // ── DOM ───────────────────────────────────────────────────
  _buildDOM() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div id="editorOverlay" class="hidden">
  <div class="editor-box">

    <!-- Header -->
    <div class="editor-header">
      <h2>&#10010; Objekt erstellen</h2>
      <button id="edCloseBtn" class="icon-btn">&#x2715;</button>
    </div>

    <!-- Body -->
    <div class="editor-body">

      <!-- Linke Spalte: Groesse + 3D-Vorschau -->
      <div class="editor-left">
        <div class="size-block">
          <h3>Groesse</h3>
          <label class="size-row">
            <span>Breite</span>
            <input type="range" id="sizeW" min="0.5" max="8" step="0.5" value="2">
            <b id="lblW">2.0</b>
          </label>
          <label class="size-row">
            <span>Hoehe</span>
            <input type="range" id="sizeH" min="0.5" max="8" step="0.5" value="2">
            <b id="lblH">2.0</b>
          </label>
          <label class="size-row">
            <span>Tiefe</span>
            <input type="range" id="sizeD" min="0.5" max="8" step="0.5" value="1">
            <b id="lblD">1.0</b>
          </label>
        </div>

        <div class="preview-block">
          <h3>3D-Vorschau</h3>
          <canvas id="previewCanvas" width="180" height="180"></canvas>
        </div>
      </div>

      <!-- Rechte Spalte: Seitenauswahl + Zeichenbereich -->
      <div class="editor-right">

        <!-- Aufgeklappter Wuerfel -->
        <h3>Seite auswaehlen</h3>
        <div class="face-grid">
          <div class="face-cell" data-face="top"    id="ft-top"   ><canvas width="64" height="64"></canvas><span>Oben</span>   </div>
          <div class="face-cell" data-face="left"   id="ft-left"  ><canvas width="64" height="64"></canvas><span>Links</span>  </div>
          <div class="face-cell active" data-face="front" id="ft-front"><canvas width="64" height="64"></canvas><span>Vorne</span>  </div>
          <div class="face-cell" data-face="right"  id="ft-right" ><canvas width="64" height="64"></canvas><span>Rechts</span> </div>
          <div class="face-cell" data-face="back"   id="ft-back"  ><canvas width="64" height="64"></canvas><span>Hinten</span> </div>
          <div class="face-cell" data-face="bottom" id="ft-bottom"><canvas width="64" height="64"></canvas><span>Unten</span>  </div>
        </div>

        <!-- Zeichenbereich -->
        <div class="draw-block">
          <div class="draw-topbar">
            <span id="edFaceLabel">Vorne</span>
            <div class="draw-tools-row">
              <input type="color" id="edColor" value="#222222" title="Farbe">
              <input type="range" id="edBrush" min="1" max="40" value="12" title="Pinselgroesse">
              <button id="edPencil" class="tool-btn active" title="Stift">&#9998;</button>
              <button id="edEraser" class="tool-btn"        title="Radierer">&#9723;</button>
              <button id="edClear"  class="tool-btn"        title="Seite loeschen">&#128465;</button>
            </div>
          </div>
          <canvas id="edDrawCanvas" width="256" height="256"></canvas>
        </div>
      </div>
    </div><!-- /body -->

    <!-- Footer -->
    <div class="editor-footer">
      <button id="edCancelBtn"  class="btn-secondary">Abbrechen</button>
      <button id="edActivateBtn" class="btn-primary">Aktivieren &#8594; Platzieren</button>
    </div>

  </div><!-- /editor-box -->
</div><!-- /editorOverlay -->
    `;
    document.body.appendChild(wrap.firstElementChild);
  }

  // ── Events ────────────────────────────────────────────────
  _bindEvents() {

    // Schliessen
    this._el('edCloseBtn').addEventListener('click',  () => this.close());
    this._el('edCancelBtn').addEventListener('click', () => this.close());

    // Aktivieren
    this._el('edActivateBtn').addEventListener('click', () => {
      this.onActivate({
        faceTextures: this.getFaceTextures(),
        faceCanvases: this.faceCanvases,   // fuer lokale Ghost-Textur (kein decode noetig)
        width:  this.size.w,
        height: this.size.h,
        depth:  this.size.d
      });
      this.close();
    });

    // Seite auswaehlen
    document.querySelectorAll('.face-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        this.currentFace = cell.dataset.face;
        document.querySelectorAll('.face-cell').forEach(c => c.classList.remove('active'));
        cell.classList.add('active');
        this._loadFaceToCanvas(this.currentFace);
        this._el('edFaceLabel').textContent = FACE_DE[this.currentFace];
      });
    });

    // Groessenschieberegler
    [['W', 'w'], ['H', 'h'], ['D', 'd']].forEach(([upper, lower]) => {
      this._el(`size${upper}`).addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        this.size[lower] = v;
        this._el(`lbl${upper}`).textContent = v.toFixed(1);
        this._rebuildPreviewMesh();
      });
    });

    // Werkzeuge
    this._el('edColor').addEventListener('input', e => {
      this.color = e.target.value;
      this._setTool('pencil');
    });
    this._el('edBrush').addEventListener('input', e => {
      this.brush = parseInt(e.target.value);
    });
    this._el('edPencil').addEventListener('click', () => this._setTool('pencil'));
    this._el('edEraser').addEventListener('click', () => this._setTool('eraser'));
    this._el('edClear').addEventListener('click',  () => {
      const ctx = this.faceCanvases[this.currentFace].getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 128, 128);
      this._loadFaceToCanvas(this.currentFace);
      this._refreshThumbnails();
      this._rebuildPreviewMesh();
    });

    // Zeichnen auf Haupt-Canvas
    const dc = this._el('edDrawCanvas');
    const pos = e => {
      const r  = dc.getBoundingClientRect();
      const s  = e.touches ? e.touches[0] : e;
      return {
        x: (s.clientX - r.left) * dc.width  / r.width,
        y: (s.clientY - r.top)  * dc.height / r.height
      };
    };
    const paint = e => {
      if (!this.isDrawing) return;
      if (e.cancelable) e.preventDefault();
      this._paintAt(pos(e));
    };
    const stop = () => {
      if (this.isDrawing) {
        this.isDrawing = false;
        this._refreshThumbnails();
        this._rebuildPreviewMesh();
      }
    };

    dc.addEventListener('mousedown',  e => { this.isDrawing = true; paint(e); });
    dc.addEventListener('mousemove',  paint);
    dc.addEventListener('mouseup',    stop);
    dc.addEventListener('mouseleave', stop);
    dc.addEventListener('touchstart', e => { this.isDrawing = true; paint(e); }, { passive: false });
    dc.addEventListener('touchmove',  paint, { passive: false });
    dc.addEventListener('touchend',   stop);
  }

  // ── Zeichnen ──────────────────────────────────────────────
  _paintAt({ x, y }) {
    const r     = this.brush / 2;
    const fill  = this.tool === 'eraser' ? '#ffffff' : this.color;
    const scale = 128 / 256;   // drawCanvas ist 256px, faceCanvas 128px

    // Haupt-Canvas
    const dCtx = this._el('edDrawCanvas').getContext('2d');
    dCtx.beginPath();
    dCtx.arc(x, y, r, 0, Math.PI * 2);
    dCtx.fillStyle = fill;
    dCtx.fill();

    // Face-Canvas (skaliert)
    const fCtx = this.faceCanvases[this.currentFace].getContext('2d');
    fCtx.beginPath();
    fCtx.arc(x * scale, y * scale, Math.max(0.5, r * scale), 0, Math.PI * 2);
    fCtx.fillStyle = fill;
    fCtx.fill();
  }

  _loadFaceToCanvas(face) {
    const dc  = this._el('edDrawCanvas');
    const ctx = dc.getContext('2d');
    ctx.clearRect(0, 0, dc.width, dc.height);
    ctx.drawImage(this.faceCanvases[face], 0, 0, dc.width, dc.height);
  }

  _refreshThumbnails() {
    FACE_MAT_ORDER.forEach(f => {
      const thumb = document.querySelector(`#ft-${f} canvas`);
      if (!thumb) return;
      const ctx = thumb.getContext('2d');
      ctx.drawImage(this.faceCanvases[f], 0, 0, 64, 64);
    });
  }

  _setTool(name) {
    this.tool = name;
    this._el('edPencil').classList.toggle('active', name === 'pencil');
    this._el('edEraser').classList.toggle('active', name === 'eraser');
  }

  // ── 3D-Vorschau ───────────────────────────────────────────
  _initPreview() {
    const canvas = this._el('previewCanvas');
    this._prevRend = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this._prevRend.setSize(180, 180);
    this._prevRend.setClearColor(0x000000, 0);

    this._prevScene = new THREE.Scene();
    this._prevCam   = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this._prevCam.position.set(4.5, 3, 4.5);
    this._prevCam.lookAt(0, 0, 0);

    this._prevScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(3, 5, 3);
    this._prevScene.add(sun);

    this._rebuildPreviewMesh();
  }

  _rebuildPreviewMesh() {
    if (this._prevMesh) {
      this._prevScene.remove(this._prevMesh);
      this._prevMesh.geometry.dispose();
    }
    const { w, h, d } = this.size;
    const geo  = new THREE.BoxGeometry(w, h, d);
    const mats = FACE_MAT_ORDER.map(f => {
      const tex = new THREE.CanvasTexture(this.faceCanvases[f]);
      tex.minFilter = THREE.LinearFilter;
      return new THREE.MeshLambertMaterial({ map: tex });
    });
    this._prevMesh = new THREE.Mesh(geo, mats);
    this._prevScene.add(this._prevMesh);
  }

  _startPreview() {
    const tick = () => {
      this._prevAnim = requestAnimationFrame(tick);
      if (this._prevMesh) this._prevMesh.rotation.y += 0.013;
      this._prevRend.render(this._prevScene, this._prevCam);
    };
    tick();
  }

  _stopPreview() {
    if (this._prevAnim) { cancelAnimationFrame(this._prevAnim); this._prevAnim = null; }
  }

  // ── Util ──────────────────────────────────────────────────
  _el(id) { return document.getElementById(id); }
}
