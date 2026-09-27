import { test, expect } from '@playwright/test';
import { openZip, readEntry, entryBlob, decodeName, ZipError } from '../src/zip.ts';
import { writeZip, offsetSource } from './fixtures/zip-writer.ts';

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const blobOf = (b: Uint8Array) => new Blob([b.slice()]);
const big = 'song '.repeat(10_000);

test('stored and deflated entries round trip, with a zip comment', async () => {
  const zip = writeZip(
    [
      { name: 'a/song.ini', data: '[song]\nname = A\n', method: 0 },
      { name: 'a/notes.mid', data: big, method: 8 },
      { name: 'a/', data: '', method: 0 },
    ],
    { comment: 'packed by a test' },
  );
  const archive = await openZip(blobOf(zip));
  expect(archive.entries.map((e) => e.name)).toEqual(['a/song.ini', 'a/notes.mid', 'a/']);
  const [ini, mid] = archive.entries;
  expect(ini.method).toBe(0);
  expect(mid.method).toBe(8);
  expect(mid.compressedSize).toBeLessThan(mid.size);
  expect(text(await readEntry(archive, ini))).toBe('[song]\nname = A\n');
  expect(text(await readEntry(archive, mid))).toBe(big);
  expect(await (await entryBlob(archive, ini)).text()).toBe('[song]\nname = A\n');
  const blob = await entryBlob(archive, mid, 'audio/ogg');
  expect(blob.type).toBe('audio/ogg');
  expect(await blob.text()).toBe(big);
});

test('entry names: UTF-8 flag, CP437 fallback and Info-ZIP Unicode Path', async () => {
  const cp437 = new Uint8Array([0x4d, 0x94, 0x74, 0x6c, 0x65, 0x79, 0x20, 0x43, 0x72, 0x81, 0x65, 0x2f, 0x78]);
  const zip = writeZip([
    { name: 'Björk/song.ini', data: 'x', utf8: true },
    { name: 'Björk/notes.mid', data: 'x' },
    { name: cp437, data: 'x' },
    { name: 'plain.ini', data: 'x', unicodePath: 'Café.ini' },
  ]);
  const archive = await openZip(blobOf(zip));
  expect(archive.entries.map((e) => e.name)).toEqual(['Björk/song.ini', 'Björk/notes.mid', 'Mötley Crüe/x', 'Café.ini']);
  expect(decodeName(new Uint8Array([0x96, 0xe1, 0xff]), false)).toBe('ûß\u00a0');
  expect(decodeName(new Uint8Array([0xe2, 0x80, 0x93]), false)).toBe('\u2013');
});

test('offsets past 2 GB without ZIP64 are read unsigned', async () => {
  const base = 3_000_000_000;
  const zip = writeZip([{ name: 'far/song.ini', data: big }], { baseOffset: base });
  const archive = await openZip(offsetSource(zip, base));
  expect(archive.entries[0].localOffset).toBe(base);
  expect(text(await readEntry(archive, archive.entries[0]))).toBe(big);
});

test('ZIP64 records and extra fields', async () => {
  const base = 5_000_000_000;
  const zip = writeZip(
    [
      { name: 'x/song.ogg', data: big, method: 0 },
      { name: 'x/notes.mid', data: big },
    ],
    { baseOffset: base, zip64: true, comment: 'z' },
  );
  const archive = await openZip(offsetSource(zip, base));
  expect(archive.entries.map((e) => [e.name, e.size])).toEqual([
    ['x/song.ogg', big.length],
    ['x/notes.mid', big.length],
  ]);
  expect(archive.entries[1].localOffset).toBeGreaterThan(base);
  expect(text(await readEntry(archive, archive.entries[0]))).toBe(big);
  expect(text(await readEntry(archive, archive.entries[1]))).toBe(big);
});

test('rejects bad archives and hostile entries', async () => {
  await expect(openZip(blobOf(new TextEncoder().encode('Rar!\x1a\x07\x00 not a zip at all')))).rejects.toThrow(ZipError);
  await expect(openZip(blobOf(new Uint8Array(4)))).rejects.toThrow('Not a zip file');

  const zip = writeZip([
    { name: 'bomb.mid', data: big, declaredSize: 100 },
    { name: 'secret.ini', data: 'x', flags: 1 },
    { name: 'lzma.ogg', data: 'x', method: 14 },
    { name: 'short.ini', data: 'x'.repeat(50), declaredSize: 60 },
  ]);
  const archive = await openZip(blobOf(zip));
  const [bomb, secret, lzma, short] = archive.entries;
  await expect(readEntry(archive, bomb)).rejects.toThrow('larger than its declared size');
  await expect(entryBlob(archive, bomb)).rejects.toThrow('larger than its declared size');
  await expect(readEntry(archive, secret)).rejects.toThrow('encrypted');
  await expect(readEntry(archive, lzma)).rejects.toThrow('unsupported compression method 14');
  await expect(readEntry(archive, short)).rejects.toThrow('size mismatch');
  await expect(readEntry(archive, short, 10)).rejects.toThrow('too large');
});
