export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

const tokenize = (text: string) => text.match(/\s+|[\p{L}\p{N}\p{M}_]+|[^\s]/gu) ?? [];

// Bound the search for unrelated, lengthy transcripts. The fallback still preserves
// both texts exactly, but displays their differing middle as one replacement.
export function transcriptDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const left = a.slice(start, a.length - end);
  const right = b.slice(start, b.length - end);
  const parts: DiffPart[] = [];
  function append(kind: DiffPart["kind"], text: string) {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else parts.push({ kind, text });
  }
  append("same", a.slice(0, start).join(""));
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let work = 0;
  let complete = false;
  search: for (let depth = 0; depth <= left.length + right.length; depth++) {
    trace.push(new Map(frontier));
    for (let k = -depth; k <= depth; k += 2) {
      if (++work > 50000) break search;
      let x =
        k === -depth || (k !== depth && (frontier.get(k - 1) ?? -1) < (frontier.get(k + 1) ?? -1))
          ? (frontier.get(k + 1) ?? 0)
          : (frontier.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        if (++work > 50000) break search;
        x++;
        y++;
      }
      frontier.set(k, x);
      if (x >= left.length && y >= right.length) {
        const reversed: DiffPart[] = [];
        for (let d = depth; d >= 0; d--) {
          const previous = trace[d];
          const diagonal = x - y;
          const priorDiagonal =
            diagonal === -d ||
            (diagonal !== d &&
              (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1))
              ? diagonal + 1
              : diagonal - 1;
          const priorX = previous.get(priorDiagonal) ?? 0;
          const priorY = priorX - priorDiagonal;
          while (x > priorX && y > priorY) {
            reversed.push({ kind: "same", text: left[--x] });
            y--;
          }
          if (d > 0) {
            if (x === priorX) reversed.push({ kind: "added", text: right[--y] });
            else reversed.push({ kind: "removed", text: left[--x] });
          }
        }
        for (const part of reversed.reverse()) append(part.kind, part.text);
        complete = true;
        break search;
      }
    }
  }
  if (!complete) {
    append("removed", left.join(""));
    append("added", right.join(""));
  }
  append("same", end ? a.slice(-end).join("") : "");
  return parts;
}
