/** Live ECG trace on a small canvas: scrolling PQRST waveform with a sweep gap, rate follows the heart rate. */
const gauss = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));

/** One beat, t in 0..1 (R peak = 1). */
export function ecgWave(t) {
  return 0.11 * gauss(t, 0.14, 0.028) - 0.07 * gauss(t, 0.247, 0.007) + 1.0 * gauss(t, 0.27, 0.0085) - 0.24 * gauss(t, 0.294, 0.008) + 0.27 * gauss(t, 0.47, 0.038);
}

export class Ecg {
  constructor(canvas, { width = 150, height = 44, pxPerSec = 64 } = {}) {
    this.canvas = canvas;
    this.cssW = width; this.cssH = height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * this.dpr); canvas.height = Math.round(height * this.dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    this.ctx2d = canvas.getContext('2d');
    this.w = width;
    this.buf = new Float32Array(this.w);
    this.cursor = 0;
    this.phase = 0;
    this.acc = 0;
    this.pxPerSec = pxPerSec;
    this.bpm = 64;
    this.prefill(4, 64);
  }

  /** Fills the buffer with `seconds` of trace so the first frame is not empty. */
  prefill(seconds, bpm) {
    const cols = Math.min(this.w, Math.floor(seconds * this.pxPerSec));
    this.bpm = bpm;
    for (let i = 0; i < this.w; i++) this.buf[i] = 0;
    for (let i = 0; i < cols; i++) this._push();
  }

  _push() {
    this.phase += (this.bpm / 60) / this.pxPerSec;
    if (this.phase >= 1) this.phase -= 1;
    this.buf[this.cursor] = ecgWave(this.phase) + (Math.random() - 0.5) * 0.012;
    this.cursor = (this.cursor + 1) % this.w;
  }

  /** Advances the trace by real seconds. */
  step(dt, bpm) {
    if (Number.isFinite(bpm) && bpm > 20) this.bpm = bpm;
    const d = Math.min(Math.max(dt, 0), 0.25);
    this.acc += d * this.pxPerSec;
    let cols = Math.floor(this.acc);
    this.acc -= cols;
    if (cols > this.w) cols = this.w;
    for (let i = 0; i < cols; i++) this._push();
  }

  draw(color = '#7fe6d6', alarm = false) {
    const c = this.ctx2d, w = this.cssW, h = this.cssH, s = this.dpr;
    c.setTransform(s, 0, 0, s, 0, 0);
    c.clearRect(0, 0, w, h);
    // faint grid
    c.strokeStyle = 'rgba(120,190,240,0.10)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0.5; x < w; x += 20) { c.moveTo(x, 0); c.lineTo(x, h); }
    for (let y = 0.5; y < h; y += 11) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    const base = h * 0.7, amp = h * 0.58;
    const gap = 10;
    c.strokeStyle = alarm ? '#ffb84d' : color; c.lineWidth = 1.4; c.lineJoin = 'round';
    c.shadowColor = alarm ? 'rgba(255,184,77,0.5)' : 'rgba(127,230,214,0.5)'; c.shadowBlur = 3;
    c.beginPath();
    let pen = false;
    for (let x = 0; x < w; x++) {
      // columns just ahead of the cursor are blank (sweep), fading in behind it
      const ahead = (x - this.cursor + this.w) % this.w;
      if (ahead < gap) { pen = false; continue; }
      const y = base - this.buf[x] * amp;
      if (!pen) { c.moveTo(x, y); pen = true; } else c.lineTo(x, y);
    }
    c.stroke();
    c.shadowBlur = 0;
    // cursor dot
    const cx = (this.cursor - 1 + this.w) % this.w;
    c.fillStyle = alarm ? '#ffd58a' : '#d8fff8';
    c.beginPath(); c.arc(cx, base - this.buf[cx] * amp, 1.6, 0, Math.PI * 2); c.fill();
  }
}
