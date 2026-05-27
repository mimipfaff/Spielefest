// ─────────────────────────────────────────────────────────────
// Virtueller Joystick – Pointer Events (Maus · Touch · Stift)
// Funktioniert auf Touchscreen-Laptops, Tablets und Handys.
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

    this._pid    = null;   // aktive Pointer-ID
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

  /** true wenn gerade ein Finger / Pointer auf dem Joystick liegt */
  get active() { return this._pid !== null; }

  // ── Event-Binding (Pointer Events – funktioniert auf allen Eingabegeräten) ──
  _bindEvents() {
    // Pointer-Down: Eingabe starten und an dieses Element binden
    this.el.addEventListener('pointerdown', e => {
      if (this._pid !== null) return;      // zweiten Finger ignorieren
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId); // Bewegung außerhalb des Elements verfolgen
      this._pid    = e.pointerId;
      this._startX = this._curX = e.clientX;
      this._startY = this._curY = e.clientY;
      this._update(e.clientX, e.clientY);
    });

    // Pointer-Move: Knob-Position aktualisieren
    this.el.addEventListener('pointermove', e => {
      if (e.pointerId !== this._pid) return;
      this._curX = e.clientX;
      this._curY = e.clientY;
      this._update(e.clientX, e.clientY);
    });

    // Pointer-Up / Cancel: Joystick zurücksetzen
    const onEnd = e => {
      if (e.pointerId !== this._pid) return;

      // Tap erkennen: kaum Bewegung → Angriff / Aktion auslösen
      const disp = Math.hypot(
        this._curX - this._startX,
        this._curY - this._startY
      );
      if (disp < 12 && this.onTap) this.onTap();

      // Joystick zurücksetzen
      this._pid = null;
      this.dx = this.dy = this.mag = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.el.classList.remove('joy-active');
    };
    this.el.addEventListener('pointerup',     onEnd);
    this.el.addEventListener('pointercancel', onEnd);
  }

  // ── Knob-Position berechnen ────────────────────────────────
  _update(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const maxR = rect.width / 2 * 0.65;   // 65 % des Basis-Radius als Max-Weg

    let dx = clientX - cx;
    let dy = clientY - cy;
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
      el.addEventListener('pointerdown',   e => { e.preventDefault(); this.delta = d; });
      el.addEventListener('pointerup',     () => { this.delta = 0; });
      el.addEventListener('pointercancel', () => { this.delta = 0; });
      el.addEventListener('pointerleave',  () => { this.delta = 0; });
    }
  }
}
