// Minimal, dependency-free PNG fixture generation for photo-upload tests — builds real PNG byte
// streams (correct magic bytes, valid CRC32-checked chunks) using only Node's built-in `zlib`,
// rather than checking binary fixture files into the repo or depending on an image library just
// for tests.

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ihdrChunk(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 6; // color type: RGBA
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return pngChunk('IHDR', data);
}

/** A real, fully valid, tiny PNG — decodes correctly with real pixel data. */
export function makeValidPngBuffer(width = 2, height = 2): Buffer {
  // node's zlib is required lazily so this module has zero non-builtin imports.
  const zlib = require('zlib') as typeof import('zlib');
  const bytesPerPixel = 4;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(width * bytesPerPixel, 128)]));
  }
  const idatData = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([PNG_SIGNATURE, ihdrChunk(width, height), pngChunk('IDAT', idatData), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Correct PNG magic bytes and a syntactically valid IHDR claiming huge dimensions, but no image
 * data behind it — image-size only needs the IHDR chunk to report dimensions, so this is enough to
 * exercise the "dimensions exceed maximum" rejection without generating an actual multi-megapixel
 * file. */
export function makeOversizedPngBuffer(dimensionPx: number): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ihdrChunk(dimensionPx, dimensionPx)]);
}

/** Correct PNG magic bytes but a truncated/malformed IHDR — passes the magic-byte sniff, then
 * fails actual decode, exercising the "not a valid image" rejection path. */
export function makeCorruptPngBuffer(): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from([0x00, 0x00, 0x00])]);
}

/** No image magic bytes at all — a plain text file renamed to look like a photo. */
export function makeNonImageBuffer(): Buffer {
  return Buffer.from('this is definitely not an image, just plain text pretending to be one');
}
