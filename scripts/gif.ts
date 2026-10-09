// Turns PNG screenshots into an animated GIF (a timelapse for the README), in plain JS:
// no ffmpeg needed.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require('gifenc') as {
  GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options: { palette: number[][]; delay: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  quantize(rgba: Uint8Array, colors: number): number[][];
  applyPalette(rgba: Uint8Array, palette: number[][]): Uint8Array;
};

/** Box-filter downscale of RGBA pixels, good enough for screenshots. */
export function downscale(src: Uint8Array, sw: number, sh: number, dw: number, dh: number) {
  const out = new Uint8Array(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sums = [0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++) {
        for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) {
          const i = (yy * sw + xx) * 4;
          sums[0] += src[i]!;
          sums[1] += src[i + 1]!;
          sums[2] += src[i + 2]!;
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = sums[0]! / n;
      out[o + 1] = sums[1]! / n;
      out[o + 2] = sums[2]! / n;
      out[o + 3] = 255;
    }
  }
  return out;
}

export function writeGif(frames: Buffer[], file: string, { width = 480, delay = 90 } = {}) {
  const gif = GIFEncoder();
  for (const frame of frames) {
    const png = PNG.sync.read(frame);
    const height = Math.round((png.height / png.width) * width);
    const rgba = downscale(png.data, png.width, png.height, width, height);
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay });
  }
  gif.finish();
  writeFileSync(file, gif.bytes());
}
