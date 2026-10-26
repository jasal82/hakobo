// Zeilenweiser Vergleich (Myers) und Gruppierung in Abschnitte mit Kontext.

export interface DiffLine {
  t: 'eq' | 'del' | 'add';
  text: string;
  /** Zeilennummer im alten Text (1-basiert), sonst null. */
  a: number | null;
  /** Zeilennummer im neuen Text (1-basiert), sonst null. */
  b: number | null;
}

/** Ab so vielen Unterschieden wird nicht mehr fein verglichen. */
const MAX_EDITS = 3000;

function myers(a: string[], b: string[], offA: number, offB: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const del = (i: number): DiffLine => ({ t: 'del', text: a[i], a: offA + i + 1, b: null });
  const add = (j: number): DiffLine => ({ t: 'add', text: b[j], a: null, b: offB + j + 1 });
  if (n === 0) return b.map((_, j) => add(j));
  if (m === 0) return a.map((_, i) => del(i));
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    if (d > MAX_EDITS) break;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) {
    // Zu viele Unterschiede: alles alt entfernt, alles neu hinzugefügt.
    return [...a.map((_, i) => del(i)), ...b.map((_, j) => add(j))];
  }
  const ops: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[max + k - 1] < vd[max + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[max + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ t: 'eq', text: a[x - 1], a: offA + x, b: offB + y });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push(add(y - 1));
      else ops.push(del(x - 1));
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** Vergleicht zwei Texte zeilenweise. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n/g, '\n').split('\n');
  const b = newText.replace(/\r\n/g, '\n').split('\n');
  // Abschließende Leerzeile (Dateiende) nicht als eigene Zeile zählen.
  if (a.length > 1 && a[a.length - 1] === '') a.pop();
  if (b.length > 1 && b[b.length - 1] === '') b.pop();
  if (a.length === 1 && a[0] === '') a.pop();
  if (b.length === 1 && b[0] === '') b.pop();
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ t: 'eq', text: a[i], a: i + 1, b: i + 1 });
  out.push(...myers(a.slice(start, endA), b.slice(start, endB), start, start));
  for (let i = endA, j = endB; i < a.length; i++, j++) out.push({ t: 'eq', text: a[i], a: i + 1, b: j + 1 });
  return out;
}

export type DiffBlock = { kind: 'lines'; lines: DiffLine[] } | { kind: 'skip'; lines: DiffLine[] };

/** Gruppiert in sichtbare Abschnitte; unveränderte Bereiche außerhalb des Kontexts werden eingeklappt. */
export function diffBlocks(lines: DiffLine[], context = 3): DiffBlock[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.t === 'eq') return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true;
  });
  const blocks: DiffBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const kind = keep[i] ? 'lines' : 'skip';
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.lines.push(lines[i]);
    else blocks.push({ kind, lines: [lines[i]] });
  }
  return blocks;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.t === 'add') added++;
    else if (l.t === 'del') removed++;
  }
  return { added, removed };
}
