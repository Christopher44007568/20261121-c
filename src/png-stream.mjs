import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { createDeflate } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);

for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(type, data) {
  let crc = 0xffffffff;
  for (let i = 0; i < type.length; i += 1) {
    crc = CRC_TABLE[(crc ^ type.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.allocUnsafe(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(type, data), 8 + data.length);
  return result;
}

function writeChunk(stream, type, data) {
  return writeBuffer(stream, pngChunk(type, data));
}

async function writeBuffer(stream, data) {
  await new Promise((resolve, reject) => {
    stream.write(data, (error) => (error ? reject(error) : resolve()));
  });
}

function scanline(rgba, previous) {
  if (rgba.length !== previous.length) {
    throw new RangeError("scanline lengths differ");
  }
  const bytes = rgba.length;
  const out = Buffer.allocUnsafe(bytes + 1);

  let none = 0;
  let sub = 0;
  let up = 0;
  let average = 0;
  let paeth = 0;
  const stride = 4;

  for (let i = 0; i < bytes; i += 1) {
    const left = i >= stride ? rgba[i - stride] : 0;
    const above = previous[i];
    const upperLeft = i >= stride ? previous[i - stride] : 0;
    const estimate = left + above - upperLeft;
    const da = Math.abs(estimate - left);
    const db = Math.abs(estimate - above);
    const dc = Math.abs(estimate - upperLeft);
    const paethLeft = da <= db && da <= dc ? left : db <= dc ? above : upperLeft;

    none += Math.abs((rgba[i] << 24) >> 24);
    sub += Math.abs((((rgba[i] - left) & 0xff) << 24) >> 24);
    up += Math.abs((((rgba[i] - above) & 0xff) << 24) >> 24);
    average += Math.abs(
      (((rgba[i] - ((left + above) >> 1)) & 0xff) << 24) >> 24,
    );
    paeth += Math.abs((((rgba[i] - paethLeft) & 0xff) << 24) >> 24);
  }

  const scores = [none, sub, up, average, paeth];
  let filter = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] < scores[filter]) {
      filter = i;
    }
  }

  out[0] = filter;
  for (let i = 0; i < bytes; i += 1) {
    const left = i >= stride ? rgba[i - stride] : 0;
    const above = previous[i];
    const upperLeft = i >= stride ? previous[i - stride] : 0;
    let predictor;
    if (filter === 0) {
      predictor = 0;
    } else if (filter === 1) {
      predictor = left;
    } else if (filter === 2) {
      predictor = above;
    } else if (filter === 3) {
      predictor = (left + above) >> 1;
    } else {
      const estimate = left + above - upperLeft;
      const da = Math.abs(estimate - left);
      const db = Math.abs(estimate - above);
      const dc = Math.abs(estimate - upperLeft);
      predictor =
        da <= db && da <= dc ? left : db <= dc ? above : upperLeft;
    }
    out[i + 1] = (rgba[i] - predictor) & 0xff;
  }
  return out;
}

/**
 * A bounded-memory, top-to-bottom PNG writer. It keeps one source row and one
 * previous row, plus zlib's fixed-size internal buffers. IDAT data is emitted
 * as it becomes available.
 */
export class StreamingPngWriter {
  constructor({ path, width, height, compressionLevel = 6 }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("PNG dimensions must be positive integers");
    }
    this.path = path;
    this.width = width;
    this.height = height;
    this.compressionLevel = compressionLevel;
    this.rowsWritten = 0;
    this.bytesWritten = 0;
    this._previous = new Uint8Array(width * 4);
    this._file = null;
    this._deflate = null;
    this._idatTask = null;
    this._finished = false;
  }

  async start() {
    if (this._file) {
      throw new Error("PNG writer already started");
    }
    this._file = createWriteStream(this.path, { highWaterMark: 1 << 20 });
    await once(this._file, "open");

    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8;
    header[9] = 6;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    await writeBuffer(
      this._file,
      Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header)]),
    );
    this.bytesWritten += PNG_SIGNATURE.length + 25;

    this._deflate = createDeflate({ level: this.compressionLevel });
    this._idatTask = this._consumeIdat();
  }

  async _consumeIdat() {
    for await (const chunk of this._deflate) {
      const encoded = pngChunk("IDAT", chunk);
      this.bytesWritten += encoded.length;
      await writeBuffer(this._file, encoded);
    }
  }

  async writeRow(rgba) {
    if (this.rowsWritten >= this.height) {
      throw new RangeError("received more rows than declared");
    }
    if (rgba.length !== this.width * 4) {
      throw new RangeError(
        `row ${this.rowsWritten}: expected ${this.width * 4} bytes, got ${rgba.length}`,
      );
    }

    const encoded = scanline(rgba, this._previous);
    await new Promise((resolve, reject) => {
      this._deflate.write(encoded, (error) => (error ? reject(error) : resolve()));
    });
    this._previous.set(rgba);
    this.rowsWritten += 1;
  }

  async finish() {
    if (this._finished) {
      return { path: this.path, bytesWritten: this.bytesWritten, rows: this.rowsWritten };
    }
    if (this.rowsWritten !== this.height) {
      throw new RangeError(
        `PNG has ${this.rowsWritten} rows, expected ${this.height}; call abort() on failure`,
      );
    }

    this._deflate.end();
    await this._idatTask;
    const end = pngChunk("IEND");
    this.bytesWritten += end.length;
    await writeBuffer(this._file, end);
    await new Promise((resolve, reject) => {
      this._file.end((error) => (error ? reject(error) : resolve()));
    });
    this._finished = true;
    return { path: this.path, bytesWritten: this.bytesWritten, rows: this.rowsWritten };
  }

  async abort() {
    this._deflate?.destroy();
    this._file?.destroy();
    try {
      await this._idatTask;
    } catch {
      // Destruction intentionally interrupts the compressor.
    }
  }
}
