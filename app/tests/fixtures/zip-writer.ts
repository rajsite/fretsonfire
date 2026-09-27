// Minimal zip writer for test fixtures: stored/deflated entries, optional ZIP64 records and a virtual base offset.
import zlib from 'node:zlib';

export interface WriteEntry {
  name: string | Uint8Array;
  data: Uint8Array | string;
  method?: 0 | 8 | number;
  utf8?: boolean;
  flags?: number;
  // Info-ZIP Unicode Path extra field.
  unicodePath?: string;
  // Overrides the uncompressed size recorded in the central directory.
  declaredSize?: number;
}

export interface WriteOptions {
  comment?: string;
  zip64?: boolean;
  // Offsets are written as if this many bytes preceded the returned data.
  baseOffset?: number;
}

const enc = new TextEncoder();

function bytesOf(v: Uint8Array | string): Uint8Array {
  return typeof v === 'string' ? enc.encode(v) : v;
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }
  struct(fields: [number, 2 | 4 | 8][]): void {
    const size = fields.reduce((n, [, w]) => n + w, 0);
    const view = new DataView(new ArrayBuffer(size));
    let p = 0;
    for (const [v, w] of fields) {
      if (w === 2) view.setUint16(p, v, true);
      else if (w === 4) view.setUint32(p, v, true);
      else view.setBigUint64(p, BigInt(v), true);
      p += w;
    }
    this.push(new Uint8Array(view.buffer));
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

function extraField(id: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, id, true);
  view.setUint16(2, body.length, true);
  out.set(body, 4);
  return out;
}

export function writeZip(entries: WriteEntry[], options: WriteOptions = {}): Uint8Array {
  const base = options.baseOffset ?? 0;
  const w = new Writer();
  const central = new Writer();
  for (const entry of entries) {
    const name = bytesOf(entry.name);
    const raw = bytesOf(entry.data);
    const method = entry.method ?? 8;
    const data = method === 8 ? new Uint8Array(zlib.deflateRawSync(raw)) : raw;
    const crc = zlib.crc32(raw);
    const flags = (entry.flags ?? 0) | (entry.utf8 ? 0x800 : 0);
    const offset = base + w.length;
    w.struct([[0x04034b50, 4], [20, 2], [flags, 2], [method, 2], [0, 2], [0x21, 2], [crc, 4], [data.length, 4], [raw.length, 4], [name.length, 2], [0, 2]]);
    w.push(name);
    w.push(data);

    const size = entry.declaredSize ?? raw.length;
    const extras: Uint8Array[] = [];
    if (options.zip64) {
      const body = new DataView(new ArrayBuffer(24));
      body.setBigUint64(0, BigInt(size), true);
      body.setBigUint64(8, BigInt(data.length), true);
      body.setBigUint64(16, BigInt(offset), true);
      extras.push(extraField(0x0001, new Uint8Array(body.buffer)));
    }
    if (entry.unicodePath) {
      const u = enc.encode(entry.unicodePath);
      const body = new Uint8Array(5 + u.length);
      body[0] = 1;
      new DataView(body.buffer).setUint32(1, zlib.crc32(name), true);
      body.set(u, 5);
      extras.push(extraField(0x7075, body));
    }
    const extraLength = extras.reduce((n, e) => n + e.length, 0);
    const z = options.zip64;
    central.struct([
      [0x02014b50, 4], [45, 2], [z ? 45 : 20, 2], [flags, 2], [method, 2], [0, 2], [0x21, 2], [crc, 4],
      [z ? 0xffffffff : data.length, 4], [z ? 0xffffffff : size, 4], [name.length, 2], [extraLength, 2], [0, 2],
      [0, 2], [0, 2], [0, 4], [z ? 0xffffffff : offset, 4],
    ]);
    central.push(name);
    for (const e of extras) central.push(e);
  }

  const cdOffset = base + w.length;
  const cd = central.concat();
  w.push(cd);
  if (options.zip64) {
    const eocd64 = base + w.length;
    w.struct([[0x06064b50, 4], [44, 8], [45, 2], [45, 2], [0, 4], [0, 4], [entries.length, 8], [entries.length, 8], [cd.length, 8], [cdOffset, 8]]);
    w.struct([[0x07064b50, 4], [0, 4], [eocd64, 8], [1, 4]]);
  }
  const comment = enc.encode(options.comment ?? '');
  const z = options.zip64;
  w.struct([[0x06054b50, 4], [0, 2], [0, 2], [z ? 0xffff : entries.length, 2], [z ? 0xffff : entries.length, 2], [z ? 0xffffffff : cd.length, 4], [z ? 0xffffffff : cdOffset, 4], [comment.length, 2]]);
  w.push(comment);
  return w.concat();
}

// A zip source whose data starts at a virtual offset, for testing offsets past 2 GB without allocating them.
export function offsetSource(data: Uint8Array, baseOffset: number): { size: number; slice(start: number, end: number): Blob } {
  return {
    size: baseOffset + data.length,
    slice(start: number, end: number) {
      const pad = Math.max(0, baseOffset - start);
      if (pad > 1 << 20) throw new Error(`read far below the virtual base: ${start}`);
      return new Blob([new Uint8Array(pad), data.slice(Math.max(0, start - baseOffset), end - baseOffset)]);
    },
  };
}
