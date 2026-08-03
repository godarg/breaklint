/**
 * A minimal PNG decoder — 8 bit, non-interlaced, greyscale/RGB/RGBA — over `node:zlib`.
 *
 * It exists for one reason: an evidence file written by the browser must be readable by
 * something that is not the browser. Asking the page whether it wrote a PNG, and whether the
 * PNG says what the page says, is a check whose truth comes from the thing under test.
 *
 * It is deliberately in `tests/`, not in `src/`. The product writes PNG files; it never reads
 * them back, and a decoder in the shipped tree would be a dependency nobody needs.
 */

import { inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colourType = data[9]!;
      interlace = data[12]!;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported`);
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colourType];
  if (!channels) throw new Error(`colour type ${colourType} not supported`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let position = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[position++]!;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const current = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? current[x - channels]! : 0;
      const b = previous ? previous[x]! : 0;
      const c = previous && x >= channels ? previous[x - channels]! : 0;
      let v = line[x]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 0xff;
          break;
        case 2:
          v = (v + b) & 0xff;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default:
          throw new Error(`unknown filter ${filter}`);
      }
      current[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

/** Pixels differing in any of R, G, B. -1 when the two images are not the same shape. */
export function comparePng(a: DecodedPng, b: DecodedPng): number {
  if (a.width !== b.width || a.height !== b.height) return -1;
  let n = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    const ia = p * a.channels;
    const ib = p * b.channels;
    for (let c = 0; c < 3; c++) {
      if (a.data[ia + c] !== b.data[ib + c]) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Pixels darker than `threshold` in luminance. Used to tell a drawn page from a blank one. */
export function inkPixels(png: DecodedPng, threshold = 200): number {
  let n = 0;
  for (let p = 0; p < png.width * png.height; p++) {
    const i = p * png.channels;
    const r = png.data[i]!;
    const g = png.channels >= 3 ? png.data[i + 1]! : r;
    const b = png.channels >= 3 ? png.data[i + 2]! : r;
    if (0.299 * r + 0.587 * g + 0.114 * b < threshold) n++;
  }
  return n;
}
