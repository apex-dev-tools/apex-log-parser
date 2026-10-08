import { memoryUsage } from 'node:process';

const MAX_ROUNDS = 20;

/**
 * Heap plus array buffers after a full GC, in bytes. V8 frees an array buffer's memory off the
 * main thread after the GC, so one reading can still count buffers that are already garbage. This
 * collects until the reading stops falling, and returns the lowest.
 */
export async function liveBytes(): Promise<number> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('Run with node --expose-gc');
  let lowest = Number.POSITIVE_INFINITY;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    gc();
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    const { heapUsed, arrayBuffers } = memoryUsage();
    const now = heapUsed + arrayBuffers;
    if (now >= lowest) return lowest;
    lowest = now;
  }
  return lowest;
}
