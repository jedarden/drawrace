export type PrngState = [number, number, number, number];

export function sfc32(seed: number): { next(): number; state(): PrngState } {
  let a = seed | 0;
  let b = (seed >>> 8) | 0;
  let c = (seed >>> 16) | 0;
  let d = ((seed >>> 24) ^ 0xDEAD) | 0;

  function next(): number {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  return {
    next,
    state(): PrngState {
      return [a, b, c, d];
    },
  };
}

export function hashSeed(trackId: string, playerId: string, runIndex: number): number {
  const str = `${trackId}:${playerId}:${runIndex}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
