// Non-blocking GPU pass timing via timestamp-query (Документ §19: use the backend timestamp capability without blocking
// the CPU on a per-frame readback; when timestamps are unavailable report null, never substitute CPU time).
//
// A ring of readback slots: each timed frame resolves its queries into its own slot and maps it asynchronously.
// When every slot is still in flight the frame is simply not timed (gpuMs stays null for it).

export interface GpuFrameTiming {
  frameId: number;
  /** Span from the first pass start to the last pass end of the frame (ms). Includes inter-pass gaps. */
  totalMs: number;
  /** Sum of pass durations per budget group (ms). */
  groups: Record<string, number>;
}

interface Slot {
  state: 'free' | 'recording' | 'mapping';
  frameId: number;
  readback: GPUBuffer;
  passGroups: string[];
}

const QUERY_ALIGN = 256;

export class GpuTimer {
  readonly enabled: boolean;
  private readonly maxPasses: number;
  private readonly slots: Slot[] = [];
  private querySet: GPUQuerySet | null = null;
  private resolveBuffer: GPUBuffer | null = null;
  private current: Slot | null = null;
  private currentIndex = -1;
  private destroyed = false;
  private readonly slotBytes: number;
  onResult: ((t: GpuFrameTiming) => void) | null = null;
  /** Frames that could not be timed because all slots were busy (reported for honesty). */
  droppedFrames = 0;

  constructor(device: GPUDevice, enabled: boolean, maxPassesPerFrame = 32, ringSize = 6) {
    this.enabled = enabled;
    this.maxPasses = maxPassesPerFrame;
    this.slotBytes = Math.ceil((maxPassesPerFrame * 2 * 8) / QUERY_ALIGN) * QUERY_ALIGN;
    if (!enabled) return;
    this.querySet = device.createQuerySet({ label: 'gpu-timer', type: 'timestamp', count: ringSize * maxPassesPerFrame * 2 });
    this.resolveBuffer = device.createBuffer({
      label: 'gpu-timer-resolve',
      size: ringSize * this.slotBytes,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    for (let i = 0; i < ringSize; i++) {
      this.slots.push({
        state: 'free',
        frameId: -1,
        passGroups: [],
        readback: device.createBuffer({ label: `gpu-timer-readback-${i}`, size: this.slotBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      });
    }
  }

  /** Starts timing a frame; returns false when the frame will not be timed. */
  beginFrame(frameId: number): boolean {
    this.current = null;
    this.currentIndex = -1;
    if (!this.enabled || this.destroyed) return false;
    const idx = this.slots.findIndex((s) => s.state === 'free');
    if (idx < 0) { this.droppedFrames++; return false; }
    const slot = this.slots[idx];
    slot.state = 'recording';
    slot.frameId = frameId;
    slot.passGroups = [];
    this.current = slot;
    this.currentIndex = idx;
    return true;
  }

  /** timestampWrites for one pass attributed to a budget group, or undefined when the frame is not timed. */
  pass(group: string): GPURenderPassTimestampWrites | undefined {
    const slot = this.current;
    if (!slot || !this.querySet || slot.passGroups.length >= this.maxPasses) return undefined;
    const base = this.currentIndex * this.maxPasses * 2 + slot.passGroups.length * 2;
    slot.passGroups.push(group);
    return { querySet: this.querySet, beginningOfPassWriteIndex: base, endOfPassWriteIndex: base + 1 };
  }

  /** Records the resolve + copy for the current frame into the encoder (call before finish()). */
  endFrame(encoder: GPUCommandEncoder): void {
    const slot = this.current;
    if (!slot || !this.querySet || !this.resolveBuffer) return;
    const count = slot.passGroups.length * 2;
    if (count === 0) { slot.state = 'free'; this.current = null; return; }
    const first = this.currentIndex * this.maxPasses * 2;
    const offset = this.currentIndex * this.slotBytes;
    encoder.resolveQuerySet(this.querySet, first, count, this.resolveBuffer, offset);
    encoder.copyBufferToBuffer(this.resolveBuffer, offset, slot.readback, 0, count * 8);
  }

  /** Starts the asynchronous readback of the frame recorded by endFrame (call after queue.submit). */
  afterSubmit(): void {
    const slot = this.current;
    this.current = null;
    if (!slot || slot.state !== 'recording') return;
    if (slot.passGroups.length === 0) { slot.state = 'free'; return; }
    slot.state = 'mapping';
    slot.readback.mapAsync(GPUMapMode.READ).then(() => {
      if (this.destroyed) return;
      const n = slot.passGroups.length;
      const data = new BigUint64Array(slot.readback.getMappedRange(0, n * 16).slice(0));
      slot.readback.unmap();
      slot.state = 'free';
      const timing = this.decode(slot.frameId, slot.passGroups, data);
      if (timing && this.onResult) this.onResult(timing);
    }, () => {
      // Device lost or buffer destroyed: drop the sample silently; the frame keeps gpuMs = null.
      slot.state = 'free';
    });
  }

  private decode(frameId: number, groups: string[], data: BigUint64Array): GpuFrameTiming | null {
    let minBegin: bigint | null = null;
    let maxEnd: bigint | null = null;
    const out: Record<string, number> = {};
    let valid = 0;
    for (let i = 0; i < groups.length; i++) {
      const b = data[i * 2];
      const e = data[i * 2 + 1];
      if (b === 0n || e === 0n || e < b) continue; // invalid or reordered timestamps: skip this pass
      valid++;
      const ms = Number(e - b) / 1e6;
      out[groups[i]] = (out[groups[i]] ?? 0) + ms;
      if (minBegin === null || b < minBegin) minBegin = b;
      if (maxEnd === null || e > maxEnd) maxEnd = e;
    }
    if (valid === 0 || minBegin === null || maxEnd === null) return null;
    return { frameId, totalMs: Number(maxEnd - minBegin) / 1e6, groups: out };
  }

  destroy(): void {
    this.destroyed = true;
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const s of this.slots) s.readback.destroy();
  }
}
