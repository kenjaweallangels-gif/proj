// Ввод: клавиатура/мышь (pointer lock) и геймпад. Действия как в ARakisPlayerController.
// input.axis('move') → {x, y}; input.look → накопленная дельта за кадр; input.pressed('Interact') — фронт.
const KEYMAP = {
  KeyW: 'Fwd', ArrowUp: 'Fwd', KeyS: 'Back', ArrowDown: 'Back',
  KeyA: 'Left', ArrowLeft: 'Left', KeyD: 'Right', ArrowRight: 'Right',
  ShiftLeft: 'Sprint', ShiftRight: 'Sprint',
  AltLeft: 'SandWalk', AltRight: 'SandWalk', KeyC: 'SandWalk',
  Space: ['Jump', 'Stutter'], KeyE: 'Interact', KeyF: 'Interact', KeyT: 'Thumper',
  Escape: 'Pause', KeyP: 'PhotoMode', KeyM: 'Mask', Enter: 'Confirm', Tab: 'Skip',
};
// Стандартная раскладка геймпада (W3C): 0=A 1=B 2=X 3=Y 4=LB 5=RB 8=View 9=Start 11=RS
const PADMAP = { 0: ['Jump', 'Stutter'], 2: 'Interact', 3: 'Thumper', 4: 'SandWalk', 10: 'Sprint', 9: 'Pause', 8: 'PhotoMode', 1: 'Skip' };

export function createInput(canvas) {
  const down = new Set();
  const edges = new Set();
  const look = { x: 0, y: 0 };
  const padPrev = new Set();
  const state = {
    device: 'kbm', // 'kbm' | 'pad'
    sensitivity: 1,
    invertY: false,
    locked: false,
    enabled: true,
    look,
    held: (a) => state.enabled && down.has(a),
    pressed: (a) => edges.has(a),
    axis() {
      if (!state.enabled) return { x: 0, y: 0 };
      let x = (down.has('Right') ? 1 : 0) - (down.has('Left') ? 1 : 0);
      let y = (down.has('Fwd') ? 1 : 0) - (down.has('Back') ? 1 : 0);
      const pad = navigator.getGamepads?.()[0];
      if (pad) {
        const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
        x += dz(pad.axes[0] || 0);
        y -= dz(pad.axes[1] || 0);
      }
      const l = Math.hypot(x, y);
      return l > 1 ? { x: x / l, y: y / l } : { x, y };
    },
    requestLock() { if (!state.locked) canvas.requestPointerLock?.(); },
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    /** Вызывать в конце кадра. */
    endFrame() { edges.clear(); look.x = 0; look.y = 0; },
    /** Опрос геймпада — в начале кадра. */
    poll(dt) {
      const pad = navigator.getGamepads?.()[0];
      if (!pad) return;
      const now = new Set();
      pad.buttons.forEach((b, i) => { if (b.pressed && PADMAP[i]) for (const a of [].concat(PADMAP[i])) now.add(a); });
      for (const a of now) { if (!padPrev.has(a)) { edges.add(a); state.device = 'pad'; } down.add(a); }
      for (const a of padPrev) if (!now.has(a)) down.delete(a);
      padPrev.clear(); now.forEach((a) => padPrev.add(a));
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      const rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      if (rx || ry) { look.x += rx * 220 * dt * state.sensitivity; look.y += ry * 160 * dt * state.sensitivity; state.device = 'pad'; }
    },
  };
  addEventListener('keydown', (e) => {
    const m = KEYMAP[e.code];
    if (!m) return;
    if (e.code === 'Tab' || e.code.startsWith('Alt') || e.code === 'Space') e.preventDefault();
    for (const a of [].concat(m)) { if (!down.has(a)) edges.add(a); down.add(a); }
    state.device = 'kbm';
  });
  addEventListener('keyup', (e) => { const m = KEYMAP[e.code]; if (m) for (const a of [].concat(m)) down.delete(a); });
  addEventListener('blur', () => down.clear());
  addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    look.x += e.movementX * 0.12 * state.sensitivity;
    look.y += e.movementY * 0.12 * state.sensitivity * (state.invertY ? -1 : 1);
    state.device = 'kbm';
  });
  addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) { edges.add('Interact'); }
    if (e.button === 2) { edges.add('Stutter'); }
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => { state.locked = document.pointerLockElement === canvas; });
  return state;
}
