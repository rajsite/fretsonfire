// Read-only zip access over a Blob: only the central directory and requested entries are read.

export interface ZipSource {
  readonly size: number;
  slice(start: number, end: number): Blob;
}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface ZipArchive {
  source: ZipSource;
  entries: ZipEntry[];
}

export class ZipError extends Error {
  override name = 'ZipError';
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;

async function read(source: ZipSource, start: number, length: number): Promise<DataView> {
  if (start < 0 || start + length > source.size) throw new ZipError('Truncated zip file');
  const buf = await source.slice(start, start + length).arrayBuffer();
  if (buf.byteLength !== length) throw new ZipError('Truncated zip file');
  return new DataView(buf);
}

function u64(view: DataView, offset: number): number {
  const v = Number(view.getBigUint64(offset, true));
  if (!Number.isSafeInteger(v)) throw new ZipError('Zip offset out of range');
  return v;
}

const utf8 = new TextDecoder('utf-8');
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

// Names without the UTF-8 flag are CP437 per the spec, but some tools write UTF-8 without setting it.
export function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return utf8.decode(bytes);
  try {
    return utf8Strict.decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    return s;
  }
}

export async function openZip(source: ZipSource): Promise<ZipArchive> {
  const tailLength = Math.min(source.size, 22 + U16_MAX);
  if (tailLength < 22) throw new ZipError('Not a zip file');
  const tailStart = source.size - tailLength;
  const tail = await read(source, tailStart, tailLength);

  let eocd = -1;
  for (let i = tailLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG && i + 22 + tail.getUint16(i + 20, true) <= tailLength) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a zip file');

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  const locator = eocd - 20;
  if (locator >= 0 && tail.getUint32(locator, true) === ZIP64_LOCATOR_SIG) {
    const rec = await read(source, u64(tail, locator + 8), 56);
    if (rec.getUint32(0, true) !== ZIP64_EOCD_SIG) throw new ZipError('Corrupt ZIP64 end record');
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }

  const cd = await read(source, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cdSize || cd.getUint32(p, true) !== CENTRAL_SIG) throw new ZipError('Corrupt central directory');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLength = cd.getUint16(p + 28, true);
    const extraLength = cd.getUint16(p + 30, true);
    const commentLength = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength);
    let name = decodeName(nameBytes, (flags & FLAG_UTF8) !== 0);

    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      let q = e + 4;
      if (id === 0x0001) {
        if (size === U32_MAX) {
          size = u64(cd, q);
          q += 8;
        }
        if (compressedSize === U32_MAX) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (localOffset === U32_MAX) localOffset = u64(cd, q);
      } else if (id === 0x7075 && len > 5) {
        // Info-ZIP Unicode Path: version, CRC of the header name, UTF-8 name.
        name = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + q + 5, len - 5));
      }
      e += 4 + len;
    }

    entries.push({ name, method, flags, compressedSize, size, localOffset });
    p = extraEnd + commentLength;
  }
  return { source, entries };
}

function checkSupported(entry: ZipEntry): void {
  if (entry.flags & FLAG_ENCRYPTED) throw new ZipError(`${entry.name}: encrypted entries are not supported`);
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`${entry.name}: unsupported compression method ${entry.method}`);
}

async function dataRange(archive: ZipArchive, entry: ZipEntry): Promise<Blob> {
  checkSupported(entry);
  const local = await read(archive.source, entry.localOffset, 30);
  if (local.getUint32(0, true) !== LOCAL_SIG) throw new ZipError(`${entry.name}: corrupt local header`);
  const start = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  if (start + entry.compressedSize > archive.source.size) throw new ZipError(`${entry.name}: truncated`);
  return archive.source.slice(start, start + entry.compressedSize);
}

// The local header and data in one read; the header's name and extra fields are at most 64 KiB each.
async function compressedBytes(archive: ZipArchive, entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  checkSupported(entry);
  const end = Math.min(archive.source.size, entry.localOffset + 30 + 2 * U16_MAX + entry.compressedSize);
  const buf = new Uint8Array(await archive.source.slice(entry.localOffset, end).arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 30 || view.getUint32(0, true) !== LOCAL_SIG) throw new ZipError(`${entry.name}: corrupt local header`);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  if (start + entry.compressedSize > buf.length) throw new ZipError(`${entry.name}: truncated`);
  return buf.subarray(start, start + entry.compressedSize);
}

// Streaming a Blob costs one main-thread task per chunk, which busy game frames starve, so inflate
// from memory; the declared size also bounds hostile archives.
async function inflate(input: Uint8Array<ArrayBuffer>, entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  const out = new Uint8Array(entry.size);
  let offset = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > entry.size) {
      reader.cancel().catch(() => {});
      throw new ZipError(`${entry.name}: larger than its declared size`);
    }
    out.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== entry.size) throw new ZipError(`${entry.name}: size mismatch`);
  return out;
}

export async function readEntry(archive: ZipArchive, entry: ZipEntry, maxSize = Infinity): Promise<Uint8Array> {
  if (entry.size > maxSize) throw new ZipError(`${entry.name}: too large (${entry.size} bytes)`);
  const data = await compressedBytes(archive, entry);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new ZipError(`${entry.name}: size mismatch`);
    return data;
  }
  return inflate(data, entry);
}

// A Blob of the entry's contents: a zero-copy slice for stored entries.
export async function entryBlob(archive: ZipArchive, entry: ZipEntry, type = ''): Promise<Blob> {
  if (entry.method === 0) return (await dataRange(archive, entry)).slice(0, entry.size, type);
  return new Blob([await inflate(await compressedBytes(archive, entry), entry)], { type });
}
