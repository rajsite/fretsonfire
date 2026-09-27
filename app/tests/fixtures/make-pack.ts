// Builds a small song pack zip from the bundled songs, covering the layouts found in real packs.
import fs from 'node:fs';
import path from 'node:path';
import { writeZip, type WriteEntry } from './zip-writer.ts';

const SONGS = path.resolve(import.meta.dirname, '../../../data/songs');
const read = (song: string, file: string) => new Uint8Array(fs.readFileSync(path.join(SONGS, song, file)));

function varLen(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n) {
    out.unshift(0x80 | (n & 0x7f));
    n >>= 7;
  }
  return out;
}

// A format 1 MIDI file; tracks are [name, notes] with notes played one beat apart at 120 BPM.
export function midiFile(tracks: [string, number[]][]): Uint8Array {
  const bytes: number[] = [...'MThd'].map((c) => c.charCodeAt(0));
  bytes.push(0, 0, 0, 6, 0, 1, 0, tracks.length, 0x01, 0xe0);
  tracks.forEach(([name, notes], i) => {
    const body: number[] = [];
    if (i === 0) body.push(0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
    body.push(0, 0xff, 0x03, ...varLen(name.length), ...[...name].map((c) => c.charCodeAt(0)));
    for (const note of notes) body.push(...varLen(480), 0x90, note, 100, ...varLen(240), 0x80, note, 0);
    body.push(0, 0xff, 0x2f, 0);
    bytes.push(...[...'MTrk'].map((c) => c.charCodeAt(0)), (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff, ...body);
  });
  return new Uint8Array(bytes);
}

export const RB_GUITAR_NOTES = 20;

// "Mötley" in CP437, without the UTF-8 flag.
const CP437_NAME = new Uint8Array([...new TextEncoder().encode('Test Pack/Classic/03 M'), 0x94, ...new TextEncoder().encode('tley/')]);
const cp437Entry = (file: string, data: Uint8Array | string): WriteEntry => ({
  name: new Uint8Array([...CP437_NAME, ...new TextEncoder().encode(file)]),
  data,
});

export function makeTestPack(): Uint8Array {
  const guitar = read('tutorial', 'guitar.ogg');
  const song = read('tutorial', 'song.ogg');
  const rbMidi = midiFile([
    ['rawksd', []],
    ['PART DRUMS', [0x60, 0x60, 0x48, 0x48]],
    ['PART BASS', [0x3c]],
    ['PART GUITAR', Array.from({ length: RB_GUITAR_NOTES }, (_, i) => [0x60 + (i % 5), 0x54 + (i % 5)]).flat()],
    ['EVENTS', []],
  ]);
  return writeZip([
    { name: 'Test Pack/label.png', data: read('defy', 'label.png'), method: 0 },
    { name: 'Test Pack/Rock Band/01 RB Style/Song.ini', data: '[song]\nname = RB Style\nartist = Test Band\ndiff_guitar = 2\n' },
    { name: 'Test Pack/Rock Band/01 RB Style/Notes.mid', data: rbMidi },
    { name: 'Test Pack/Rock Band/01 RB Style/Song.ogg', data: song, method: 0 },
    { name: 'Test Pack/Rock Band/01 RB Style/Guitar.ogg', data: guitar },
    { name: 'Test Pack/Rock Band/01 RB Style/Rhythm.ogg', data: guitar },
    { name: 'Test Pack/Rock Band/01 RB Style/Drums.ogg', data: guitar },
    { name: 'Test Pack/Rock Band/01 RB Style/album.png', data: read('twibmpg', 'label.png'), method: 0 },
    { name: 'Test Pack/Rock Band/01 RB Style/thumbs.db', data: 'junk' },
    { name: 'Test Pack/Rock Band/02 Guitar Only/song.ini', data: '[song]\nname = Guitar Only\nartist = Test Band\n' },
    { name: 'Test Pack/Rock Band/02 Guitar Only/notes.mid', data: read('defy', 'notes.mid') },
    { name: 'Test Pack/Rock Band/02 Guitar Only/guitar.ogg', data: guitar },
    { name: 'Test Pack/Rock Band/02 Guitar Only/song.ini~', data: 'junk' },
    cp437Entry('song.ini', '[song]\nname = M\u00f6tley\nartist = Test Band\n'),
    cp437Entry('notes.mid', read('defy', 'notes.mid')),
    cp437Entry('song.ogg', song),
    cp437Entry('guitar.ogg', guitar),
    cp437Entry('label.png', read('bangbang', 'label.png')),
    { name: 'Test Pack/Classic/05 Secret/song.ini', data: '[song]\nname = Secret\n', flags: 1 },
    { name: 'Test Pack/Classic/05 Secret/notes.mid', data: read('defy', 'notes.mid') },
    { name: '../evil.ini', data: 'x' },
    { name: '__MACOSX/Test Pack/._label.png', data: 'x' },
  ]);
}
