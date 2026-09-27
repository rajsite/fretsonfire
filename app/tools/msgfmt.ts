// Minimal GNU gettext `msgcat | msgfmt` replacement: merges .po catalogs (msgctxt, plurals,
// fuzzy entries skipped) and writes a UTF-8 encoded .mo file.

export interface PoEntry {
  msgctxt?: string;
  msgid?: string;
  msgid_plural?: string;
  msgstr?: string[];
}

type Field = { list: string[]; index: number } | { key: 'msgctxt' | 'msgid' | 'msgid_plural' };

function unescape(s: string): string {
  return s.replace(/\\(n|t|r|"|\\|[0-7]{1,3})/g, (_, c: string) => {
    switch (c) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return String.fromCharCode(parseInt(c, 8));
    }
  });
}

function decodePo(buffer: Buffer): string {
  const charset = /charset=([\w-]+)/i.exec(buffer.toString('latin1'))?.[1] ?? 'utf-8';
  return new TextDecoder(charset.toLowerCase()).decode(buffer);
}

export function parsePo(buffer: Buffer): PoEntry[] {
  const lines = decodePo(buffer).split(/\r?\n/);
  const entries: PoEntry[] = [];
  let cur: PoEntry | null = null;
  let field: Field | null = null;
  let fuzzy = false;

  const flush = () => {
    // Like msgfmt, keep the header entry even when marked fuzzy.
    if (cur && cur.msgid !== undefined && (!fuzzy || cur.msgid === '')) entries.push(cur);
    cur = null;
    field = null;
    fuzzy = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#,') && line.includes('fuzzy')) {
      if (cur?.msgstr) flush();
      fuzzy = true;
      continue;
    }
    if (line === '' || line.startsWith('#')) {
      if (line === '' && cur) flush();
      continue;
    }
    const m = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+"(.*)"$/);
    if (m) {
      if ((m[1] === 'msgid' || m[1] === 'msgctxt') && cur?.msgstr) flush();
      const entry: PoEntry = (cur ??= {});
      if (m[1].startsWith('msgstr')) {
        const list = (entry.msgstr ??= []);
        const index = m[2] ? Number(m[2]) : 0;
        list[index] = unescape(m[3]);
        field = { list, index };
      } else {
        const key = m[1] as 'msgctxt' | 'msgid' | 'msgid_plural';
        entry[key] = unescape(m[3]);
        field = { key };
      }
      continue;
    }
    const cont = line.match(/^"(.*)"$/);
    if (cont && cur && field) {
      const f: Field = field;
      if ('list' in f) f.list[f.index] += unescape(cont[1]);
      else (cur as PoEntry)[f.key] += unescape(cont[1]);
    }
  }
  flush();
  return entries;
}

// Earlier catalogs win for duplicate messages; the header charset is rewritten to UTF-8.
export function compilePo(...buffers: Buffer[]): Buffer {
  const seen = new Set<string>();
  const merged: PoEntry[] = [];
  for (const buffer of buffers) {
    for (const e of parsePo(buffer)) {
      const key = `${e.msgctxt ?? ''}\x04${e.msgid ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.msgid === '' && e.msgstr) {
        e.msgstr[0] = e.msgstr[0].replace(/charset=[\w-]+/i, 'charset=UTF-8');
      }
      merged.push(e);
    }
  }
  const entries = merged
    .filter((e) => e.msgstr?.some((s) => s))
    .map((e): [Buffer, Buffer] => {
      let id = e.msgid ?? '';
      if (e.msgid_plural !== undefined) id += '\0' + e.msgid_plural;
      if (e.msgctxt !== undefined) id = e.msgctxt + '\x04' + id;
      return [Buffer.from(id, 'utf8'), Buffer.from((e.msgstr ?? []).join('\0'), 'utf8')];
    })
    .sort((a, b) => Buffer.compare(a[0], b[0]));

  const n = entries.length;
  const origTable = 28;
  const transTable = origTable + n * 8;
  let offset = transTable + n * 8;

  const header = Buffer.alloc(offset);
  header.writeUInt32LE(0x950412de, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(n, 8);
  header.writeUInt32LE(origTable, 12);
  header.writeUInt32LE(transTable, 16);
  header.writeUInt32LE(0, 20);
  header.writeUInt32LE(offset, 24);

  const chunks: Buffer[] = [];
  const writeTable = (table: number, strings: Buffer[]) => {
    strings.forEach((s, i) => {
      header.writeUInt32LE(s.length, table + i * 8);
      header.writeUInt32LE(offset, table + i * 8 + 4);
      chunks.push(s, Buffer.from([0]));
      offset += s.length + 1;
    });
  };
  writeTable(origTable, entries.map((e) => e[0]));
  writeTable(transTable, entries.map((e) => e[1]));
  return Buffer.concat([header, ...chunks]);
}
