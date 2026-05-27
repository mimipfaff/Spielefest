// ─────────────────────────────────────────────────────────────
// Virtueller Joystick – Touchscreen-Steuerung
// ─────────────────────────────────────────────────────────────
export class VirtualJoystick {
  /**
   * @param {HTMLElement} el – das Basis-Element des Joysticks (enthält .joy-knob)
   */
  constructor(el) {
    this.el   = el;
    this.knob = el.querySelector('.joy-knob');

    /** Normalisierter Auslenkungs-Vektor -1 … +1 */
    this.dx  = 0;
    this.dy  = 0;
    /** Betrag der Auslenkung 0 … 1 */
    this.mag = 0;

    this._tid    = null;   // aktive Touch-ID
    this._startX = 0;
    this._startY = 0;
    this._curX   = 0;
    this._curY   = 0;

    /**
     * Optional: Callback der gefeuert wird wenn der Joystick kurz angetippt
     * wird (Fingerbewegung < 12 px). Wird von KickSlap für Angriffe genutzt.
     * @type {(() => void) | null}
     */
    this.onTap = null;

    this._bindEvents();
  }

  /** true wenn gerade ein Finger auf dem Joystick liegt */
  get active() { return this._tid !== null; }

  // ── Event-Binding ─────────────────────────────────────────
  _bindEvents() {
    // Joystick-Element: Touch starten
    this.el.addEventListener('touchstart', e => {
      if (this._tid !== null) return;    // zweiten Finger ignorieren
      e.preventDefault();                // Browser-Scroll / Tap-Highlight verhindern
      const t = e.changedTouches[0];
      this._tid    = t.identifier;
      this._startX = this._curX = t.clientX;
      this._startY = this._curY = t.clientY;
      this._update(t);
    }, { passive: false });

    // Dokument: Fingerbewegung verfolgen (auch außerhalb des Elements)
    document.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._tid) {
          this._curX = t.clientX;
          this._curY = t.clientY;
          this._update(t);
        }
      }
    }, { passive: true });

    // Finger heben (touchend + touchcancel)
    const onEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._tid) continue;

        // Tap erkennen: kaum Bewegung → Angriff auslösen
        const disp = Math.hypot(
          this._curX - this._startX,
          this._curY - this._startY
        );
        if (disp < 12 && this.onTap) this.onTap();

        // Joystick zurücksetzen
        this._tid = null;
        this.dx = this.dy = this.mag = 0;
        this.knob.style.transform = 'translate(-50%, -50%)';
        this.el.classList.remove('joy-active');
      }
    };
    document.addEventListener('touchend',    onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  // ── Knob-Position berechnen ────────────────────────────────
  _update(touch) {
    const rect = this.el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const maxR = rect.width / 2 * 0.65;   // 65 % des Basis-Radius als Max-Weg

    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Knob auf Kreisbereich begrenzen
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }

    this.mag = Math.min(1, dist / maxR);
    this.dx  = dx / maxR;
    this.dy  = dy / maxR;

    this.knob.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.el.classList.add('joy-active');
  }
}

// ─────────────────────────────────────────────────────────────
// Zoom-Buttons (+  / −)
// ─────────────────────────────────────────────────────────────
export class ZoomButtons {
  /**
   * @param {HTMLElement} inEl  – Zoom-In-Button
   * @param {HTMLElement} outEl – Zoom-Out-Button
   */
  constructor(inEl, outEl) {
    /**
     * Aktuelles Zoom-Delta pro Frame:
     *  -1 = heranzoomen, 0 = neutral, +1 = rauszoomen
     */
    this.delta = 0;

    for (const [el, d] of [[inEl, -1], [outEl, 1]]) {
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        this.delta = d;
      }, { passive: false });
      el.addEventListener('touchend',   () => { this.delta = 0; });
      el.addEventListener('mousedown',  () => { this.delta = d; });
      el.addEventListener('mouseup',    () => { this.delta = 0; });
      el.addEventListener('mouseleave', () => { this.delta = 0; });
    }
  }
}
