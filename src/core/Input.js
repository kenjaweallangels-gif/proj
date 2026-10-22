/** Keyboard / mouse / pointer-lock / gamepad state. Read `keys[code]`, `mouse.dx/dy` (per frame). */
export class Input {
  constructor(domElement, { pointerLock = true } = {}) {
    this.dom = domElement;
    this.keys = Object.create(null);     // KeyboardEvent.code -> true
    this.pressed = Object.create(null);  // codes pressed this frame (cleared on endFrame)
    this.released = Object.create(null);
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, x: 0, y: 0, clicked: 0 };
    this.pointerLocked = false;
    this.wantPointerLock = pointerLock;
    this.gamepad = null;
    this.enabled = true;
    this._listeners = [];
    this._bind();
  }

  _on(target, type, fn, opts) { target.addEventListener(type, fn, opts); this._listeners.push([target, type, fn, opts]); }

  _bind() {
    const dom = this.dom;
    this._on(window, 'keydown', (e) => {
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    this._on(window, 'keyup', (e) => { this.keys[e.code] = false; this.released[e.code] = true; });
    this._on(window, 'blur', () => { for (const k in this.keys) this.keys[k] = false; });
    this._on(dom, 'mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked || !this.wantPointerLock) { this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    this._on(dom, 'mousedown', (e) => { this.mouse.buttons |= (1 << e.button); this.mouse.clicked |= (1 << e.button); });
    this._on(window, 'mouseup', (e) => { this.mouse.buttons &= ~(1 << e.button); });
    this._on(dom, 'wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    this._on(dom, 'contextmenu', (e) => e.preventDefault());
    this._on(document, 'pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === dom; });
    this._on(window, 'gamepadconnected', (e) => { this.gamepad = e.gamepad.index; });
    this._on(window, 'gamepaddisconnected', () => { this.gamepad = null; });
  }

  requestPointerLock() {
    if (!this.wantPointerLock) return;
    try { const p = this.dom.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => this.dom.requestPointerLock()); }
    catch (_) { try { this.dom.requestPointerLock(); } catch (__) { /* ignore */ } }
  }
  exitPointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Axis helper: returns -1..1 from two key codes. */
  axis(negCode, posCode) { return (this.keys[posCode] ? 1 : 0) - (this.keys[negCode] ? 1 : 0); }
  isDown(code) { return !!this.keys[code]; }
  wasPressed(code) { return !!this.pressed[code]; }

  /** Gamepad snapshot (standard mapping) or null. */
  getGamepad() {
    if (this.gamepad === null || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[this.gamepad];
    return gp || null;
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; this.mouse.clicked = 0;
    for (const k in this.pressed) delete this.pressed[k];
    for (const k in this.released) delete this.released[k];
  }

  dispose() { for (const [t, ty, fn, o] of this._listeners) t.removeEventListener(ty, fn, o); }
}
