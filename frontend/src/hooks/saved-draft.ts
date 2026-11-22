import type { SetStateAction } from "react";

// Keep the native snapshot and the effective editing baseline separate. A write
// can succeed even when the read of its normalized native value fails.
const same = (left: unknown, right: unknown) =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);

type Row = { id: string };

function keyedRows(rows: unknown): rows is Row[] {
  return (
    Array.isArray(rows) &&
    rows.every((row) => row && typeof row.id === "string" && row.id.length > 0) &&
    new Set(rows.map((row) => row.id)).size === rows.length
  );
}

function rebaseRows(value: Row[], baseline: Row[], saved: Row[]) {
  const old = new Map(baseline.map((row) => [row.id, row]));
  const local = new Map(value.map((row) => [row.id, row]));
  const remote = new Map(saved.map((row) => [row.id, row]));
  const common = (row: Row) => old.has(row.id) && local.has(row.id) && remote.has(row.id);
  // Keep native ordering unless the editor explicitly reordered surviving rows
  // (for example by restoring a dictionary version).
  const reordered = !same(
    value.filter(common).map((row) => row.id),
    baseline.filter(common).map((row) => row.id),
  );
  const primary = reordered ? local : remote;
  const secondary = reordered ? remote : local;
  const ids = [...primary.keys()];
  // Insert rows unique to the other list before their next shared neighbor.
  let insertAt = ids.length;
  for (const id of [...secondary.keys()].reverse()) {
    if (primary.has(id)) insertAt = ids.indexOf(id);
    else ids.splice(insertAt, 0, id);
  }
  const rows: Row[] = [];
  for (const id of ids) {
    const previous = old.get(id);
    const edited = local.get(id);
    const latest = remote.get(id);
    if (!previous) rows.push((edited ?? latest)!);
    else if (edited && latest) rows.push(rebase(edited, previous, latest));
    else if (edited && !same(edited, previous)) rows.push(edited);
  }
  return rows;
}

function rebase<T>(value: T, baseline: T, saved: T): T {
  if (same(value, baseline)) return saved;
  if (keyedRows(value) && keyedRows(baseline) && keyedRows(saved))
    return (same(saved, baseline) ? value : rebaseRows(value, baseline, saved)) as T;
  if (value && baseline && saved && typeof value === "object" && !Array.isArray(value)) {
    const old = baseline as Record<string, unknown>;
    return {
      ...saved,
      ...Object.fromEntries(Object.entries(value).filter(([key, field]) => !same(field, old[key]))),
    };
  }
  return value;
}

// A dictionary receipt normalizes spellings and comma-separated aliases and
// omits empty new rows. Apply later native changes to that raw editing surface
// so an unrelated term cannot rewrite the text currently in an input.
function nativeBaseline<T>(raw: T, previous: T, saved: T): T {
  if (keyedRows(raw) && keyedRows(previous) && keyedRows(saved))
    return rebase(saved, previous, raw);
  return saved;
}

export class SaveOwner {
  running: Promise<boolean> | null = null;
  editor: symbol | undefined;
  failedVersion: string | undefined;
  private listeners = new Set<() => void>();
  revision = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.revision;
  notify() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
}

type Snapshot<T> = {
  saved: T;
  value: T;
  baseline: T;
  // A receipt and an unordered read can describe different native values.
  // Keep both until a later read or a compensating write reconciles them.
  acknowledged?: { expected: T; value: T; baseline: T; readBoundary?: number; replay: boolean };
  edits: number;
};

type Submission<T> = {
  value: T;
  baseline: T;
  saved: T;
  // Submitted fields overlaid on the latest native snapshot, before newer edits.
  anchor: T;
  received: boolean;
};

export class SavedDraft<T> {
  readonly writer = new SaveOwner();
  private listeners = new Set<() => void>();
  private state: Snapshot<T>;
  private pending?: Submission<T>;
  private readVersion?: number;

  constructor(saved: T) {
    this.state = { saved, value: saved, baseline: saved, edits: 0 };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  private update(state: Snapshot<T>) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  project(saved: T, readVersion?: number, state = this.state): Snapshot<T> {
    const changed = !same(state.saved, saved);
    if (!changed && readVersion === this.readVersion) return state;
    const pending = this.pending;
    if (pending) {
      if (!changed) return state;
      const baseline = nativeBaseline(pending.baseline, pending.saved, saved);
      const anchor = rebase(pending.value, pending.baseline, baseline);
      return {
        ...state,
        saved,
        baseline,
        value: rebase(state.value, pending.anchor, anchor),
      };
    }
    const ack = state.acknowledged;
    if (!changed && !ack) return state;
    const unordered =
      ack?.readBoundary !== undefined &&
      readVersion !== undefined &&
      readVersion <= ack.readBoundary;
    const matchesReceipt = ack && same(ack.expected, saved);
    const baseline = matchesReceipt
      ? ack.value
      : unordered
        ? rebase(ack.value, ack.baseline, saved)
        : ack
          ? nativeBaseline(ack.value, ack.expected, saved)
          : nativeBaseline(state.baseline, state.saved, saved);
    return {
      ...state,
      saved,
      baseline,
      value: rebase(state.value, state.baseline, baseline),
      // A pre-receipt result may only reach the editor after settlement.
      acknowledged: unordered ? { ...ack, replay: !matchesReceipt } : undefined,
    };
  }

  receive(saved: T, readVersion?: number) {
    const next = this.project(saved, readVersion);
    if (this.pending && (next !== this.state || this.readVersion !== readVersion)) {
      this.pending.received = true;
      const baseline = nativeBaseline(this.pending.baseline, this.pending.saved, saved);
      this.pending.anchor = rebase(this.pending.value, this.pending.baseline, baseline);
    }
    this.readVersion = readVersion;
    if (next !== this.state) this.update(next);
  }

  edit = (action: SetStateAction<T>) => {
    const state = this.state;
    const value = typeof action === "function" ? (action as (old: T) => T)(state.value) : action;
    if (!same(value, state.value)) this.update({ ...state, value, edits: state.edits + 1 });
  };

  dirty(state = this.state) {
    return !!state.acknowledged?.replay || !same(state.value, state.baseline);
  }

  get protected() {
    return !!this.pending || this.dirty();
  }

  async submit<R>(
    write: (value: T) => Promise<R> & { savedReadBoundary?: () => number | undefined },
    { value, baseline, saved, acknowledged } = this.state,
    normalizedReceipt?: (result: R) => T,
  ) {
    const submission = {
      value,
      saved,
      baseline: acknowledged?.replay ? saved : baseline,
      anchor: value,
      received: false,
    };
    this.pending = submission;
    try {
      const writing = write(value);
      const result = await writing;
      if (result === false) return false;
      if (this.pending === submission) {
        const expected = normalizedReceipt ? normalizedReceipt(result) : value;
        const state = this.state;
        const readBoundary = writing.savedReadBoundary?.();
        // Editors without a query read version publish their own saved value
        // (for example a newly committed Home result revision).
        const confirmed =
          submission.received &&
          (this.readVersion === undefined ||
            (readBoundary !== undefined && this.readVersion > readBoundary));
        // An unordered mismatch could precede the commit or be a native
        // restore. Preserve submitted intent and newer edits until an ordered
        // read settles it. If reads fail, autosave replays the rebased draft.
        const mismatch = submission.received && !same(state.saved, expected);
        const observed = mismatch
          ? confirmed
            ? nativeBaseline(value, expected, state.saved)
            : submission.anchor
          : value;
        this.update({
          ...state,
          baseline: observed,
          value: rebase(state.value, submission.anchor, observed),
          acknowledged: confirmed
            ? undefined
            : { expected, value, baseline: submission.baseline, readBoundary, replay: mismatch },
        });
      }
      return true;
    } finally {
      if (this.pending === submission) this.pending = undefined;
    }
  }
}
