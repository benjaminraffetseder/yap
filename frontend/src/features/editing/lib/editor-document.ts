import { citationPattern } from "@/features/chat/lib/chat-references";
import type { VocabularyEntry } from "@/lib/backend";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { searchHighlightAttributes } from "./search-highlight";

export type Range = { from: number; to: number };
export type TextRun = { text: string; positions: (Range & { segment?: number })[] };
export type TextChange = Range & { text: string };
type Ast = {
  type: string;
  value?: string;
  url?: string;
  children?: Ast[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  [key: string]: unknown;
};
const parser = unified().use(remarkParse).use(remarkGfm);
export const markdownTree = (source: string) => parser.parse(source) as Ast;

function escapedAt(text: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index--) count++;
  return count % 2 === 1;
}
function citationTokens(text: string, sourceEscapes: boolean): string[] {
  const urls = urlRanges(text);
  return [...text.matchAll(new RegExp(citationPattern.source, "g"))]
    .filter(
      (match) =>
        (!sourceEscapes || !escapedAt(text, match.index)) &&
        !urls.some((url) => match.index < url.to && match.index + match[0].length > url.from),
    )
    .map((match) => match[0]);
}
/** Escaped text and live markers share a visual representation; preserve that distinction in source. */
function sourceCitations(source: string, tree = markdownTree(source)) {
  const allowed = new Set<string>();
  let ambiguous = false;
  function visit(node: Ast) {
    if (node.type === "text") {
      const from = node.position?.start.offset,
        to = node.position?.end.offset;
      if (from === undefined || to === undefined) {
        ambiguous = true;
        return;
      }
      const rawTokens = citationTokens(source.slice(from, to), true);
      const remaining = new Map<string, number>();
      for (const token of rawTokens) {
        allowed.add(token);
        remaining.set(token, (remaining.get(token) ?? 0) + 1);
      }
      for (const token of citationTokens(node.value ?? "", false)) {
        const count = remaining.get(token) ?? 0;
        if (!count) ambiguous = true;
        else remaining.set(token, count - 1);
      }
    } else if (!["code", "inlineCode", "html", "definition"].includes(node.type))
      node.children?.forEach(visit);
  }
  visit(tree);
  return { allowed, ambiguous };
}

/** Keep existing Yap citation markers literal in text, without rewriting code or URLs. */
export function serializeMarkdown(
  editor: Editor,
  document = editor.state.doc,
  original = "",
): string {
  const markdown = editor.markdown!.serialize(document.toJSON());
  let citations: ReturnType<typeof sourceCitations>;
  try {
    citations = sourceCitations(original);
  } catch {
    return markdown;
  }
  // The normal gate keeps these documents in source mode. If bypassed, never guess which occurrence is live.
  if (citations.ambiguous) return markdown;
  const { allowed } = citations;
  if (!allowed.size) return markdown;
  const escapedCitations = new RegExp(
    citationPattern.source
      .replaceAll("\\[", String.raw`\\?\[`)
      .replaceAll("\\]", String.raw`\\?\]`),
    "g",
  );
  const changes: TextChange[] = [];
  function visit(node: Ast) {
    if (node.type === "text") {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from === undefined || to === undefined) return;
      const raw = markdown.slice(from, to);
      const urls = urlRanges(raw);
      const replacement = raw.replace(escapedCitations, (token: string, offset: number) => {
        const literal = token.replaceAll("\\[", "[").replaceAll("\\]", "]");
        return allowed.has(literal) &&
          !urls.some((url) => offset < url.to && offset + token.length > url.from)
          ? literal
          : token;
      });
      if (raw !== replacement) changes.push({ from, to, text: replacement });
    } else if (!["code", "inlineCode", "html", "definition"].includes(node.type))
      node.children?.forEach(visit);
  }
  visit(markdownTree(markdown));
  return applySourceChanges(markdown, changes);
}
const supported = new Set([
  "root",
  "paragraph",
  "heading",
  "text",
  "emphasis",
  "strong",
  "delete",
  "inlineCode",
  "code",
  "break",
  "thematicBreak",
  "blockquote",
  "list",
  "listItem",
  "link",
  "table",
  "tableRow",
  "tableCell",
]);
function cleanTree(node: Ast): unknown {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (["position", "spread", "data"].includes(key) || value === undefined || value === null)
      continue;
    if (key === "children") result.children = node.children?.map(cleanTree);
    else result[key] = value;
  }
  return result;
}
function supportedTree(node: Ast): boolean {
  return (
    supported.has(node.type) &&
    !(node.type === "code" && node.meta) &&
    (node.children?.every(supportedTree) ?? true)
  );
}
/** A conservative gate: unknown syntax or structural round-trip loss stays in source mode. */
export function visualCompatibility(source: string, editor: Editor): boolean {
  try {
    const tree = markdownTree(source);
    if (!supportedTree(tree) || sourceCitations(source, tree).ambiguous) return false;
    const document = editor.markdown!.parse(source);
    const serialized = editor.markdown!.serialize(document);
    return JSON.stringify(cleanTree(tree)) === JSON.stringify(cleanTree(markdownTree(serialized)));
  } catch {
    return false;
  }
}

export const searchPluginKey = new PluginKey<DecorationSet>("content-editor-search");
export const SearchHighlights = Extension.create({
  name: "contentEditorSearch",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previous) {
            const ranges = transaction.getMeta(searchPluginKey) as
              { ranges: Range[]; active: number } | undefined;
            if (ranges)
              return DecorationSet.create(
                transaction.doc,
                ranges.ranges.map((range, index) =>
                  Decoration.inline(
                    range.from,
                    range.to,
                    searchHighlightAttributes(index === ranges.active),
                  ),
                ),
              );
            return previous.map(transaction.mapping, transaction.doc);
          },
        },
        props: { decorations: (state) => searchPluginKey.getState(state) },
      }),
    ];
  },
});

/** GFM cells have one inline paragraph, no spans, and a header row. */
export function isGfmDocument(document: ProseMirrorNode): boolean {
  let valid = true;
  document.descendants((node) => {
    if (node.type.name === "table") {
      let width = -1;
      node.forEach((row, _offset, rowIndex) => {
        if (width < 0) width = row.childCount;
        if (width !== row.childCount) valid = false;
        row.forEach((cell) => {
          if (
            cell.attrs.colspan !== 1 ||
            cell.attrs.rowspan !== 1 ||
            cell.childCount !== 1 ||
            cell.firstChild?.type.name !== "paragraph" ||
            (rowIndex === 0 && cell.type.name !== "tableHeader") ||
            (rowIndex > 0 && cell.type.name !== "tableCell")
          )
            valid = false;
        });
      });
    }
    return valid;
  });
  return valid;
}
/** Keep row insertion/deletion representable by a GFM header followed by body rows. */
export function normalizeTableHeaders(transaction: Transaction): boolean {
  transaction.doc.descendants((table, tablePosition) => {
    if (table.type.name !== "table") return;
    table.forEach((row, rowOffset, rowIndex) =>
      row.forEach((cell, cellOffset) => {
        const type =
          transaction.doc.type.schema.nodes[rowIndex === 0 ? "tableHeader" : "tableCell"];
        if (cell.type !== type)
          transaction.setNodeMarkup(tablePosition + rowOffset + cellOffset + 2, type, cell.attrs);
      }),
    );
    return false;
  });
  return true;
}
const GfmGuard = Extension.create({
  name: "gfmGuard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (transaction) =>
          !transaction.docChanged || isGfmDocument(transaction.doc),
      }),
    ];
  },
});
export function editorExtensions() {
  return [
    StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell.extend({ content: "paragraph" }),
    TableHeader.extend({ content: "paragraph" }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    SearchHighlights,
    GfmGuard,
  ];
}

const word = (value: string) => /[\p{L}\p{N}\p{M}_]/u.test(value);
const before = (text: string, offset: number) =>
  Array.from(text.slice(Math.max(0, offset - 2), offset)).at(-1) ?? "";
const after = (text: string, offset: number) => Array.from(text.slice(offset, offset + 2))[0] ?? "";
const bounded = (text: string, from: number, to: number) =>
  !word(before(text, from)) && !word(after(text, to));
// ECMAScript /iu implements Unicode simple folding, including long-s, Kelvin sign and final sigma.
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function findText(
  text: string,
  query: string,
  caseSensitive = false,
  wholeWord = false,
): Range[] {
  if (!query) return [];
  const expression = new RegExp(escape(query), caseSensitive ? "gu" : "giu");
  return [...text.matchAll(expression)].flatMap((match) => {
    const from = match.index;
    const to = from + match[0].length;
    return !wholeWord || bounded(text, from, to) ? [{ from, to }] : [];
  });
}
export function mappedMatches(
  runs: TextRun[],
  query: string,
  caseSensitive = false,
  wholeWord = false,
): Range[] {
  return runs.flatMap((run) =>
    findText(run.text, query, caseSensitive, wholeWord).map((match) => ({
      from: run.positions[match.from].from,
      to: run.positions[match.to - 1].to,
    })),
  );
}

function urlRanges(text: string): Range[] {
  return [...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/giu)].map(
    (match) => ({ from: match.index, to: match.index + match[0].length }),
  );
}
function withoutUrls(run: TextRun): TextRun[] {
  const urls = urlRanges(run.text);
  if (!urls.length) return [run];
  const result: TextRun[] = [];
  let cursor = 0;
  for (const range of [...urls, { from: run.text.length, to: run.text.length }]) {
    if (range.from > cursor)
      result.push({
        text: run.text.slice(cursor, range.from),
        positions: run.positions.slice(cursor, range.from),
      });
    cursor = range.to;
  }
  return result;
}
/** Visible character offsets map directly to ProseMirror document positions, across marks. */
export function visualTextRuns(document: ProseMirrorNode, dictionary = false): TextRun[] {
  const runs: TextRun[] = [];
  document.descendants((block, position) => {
    if (!block.isTextblock) return;
    if (dictionary && block.type.spec.code) return false;
    let run: TextRun = { text: "", positions: [] };
    const flush = () => {
      if (run.text) runs.push(...(dictionary ? withoutUrls(run) : [run]));
      run = { text: "", positions: [] };
    };
    block.descendants((node, offset) => {
      if (dictionary && node.marks.some((mark) => mark.type.name === "code")) {
        flush();
        return;
      }
      if (node.isText) {
        const text = node.text!;
        run.text += text;
        for (let index = 0; index < text.length; index++)
          run.positions.push({
            from: position + 1 + offset + index,
            to: position + 2 + offset + index,
            segment: position + offset,
          });
      } else if (node.type.name === "hardBreak") {
        run.text += "\n";
        run.positions.push({ from: position + 1 + offset, to: position + 2 + offset });
      }
    });
    flush();
    return false;
  });
  return runs;
}

/** Source dictionary matching visits Markdown AST text only; syntax, code, destinations and URLs are excluded. */
export function sourceTextRuns(source: string): TextRun[] {
  const runs: TextRun[] = [];
  function block(node: Ast) {
    if (
      [
        "code",
        "inlineCode",
        "html",
        "definition",
        "image",
        "imageReference",
        "linkReference",
      ].includes(node.type)
    )
      return;
    if (["paragraph", "heading", "tableCell"].includes(node.type)) {
      let run: TextRun = { text: "", positions: [] };
      const flush = () => {
        if (run.text) runs.push(...withoutUrls(run));
        run = { text: "", positions: [] };
      };
      function inline(child: Ast) {
        if (child.type === "text") {
          const from = child.position?.start.offset;
          const to = child.position?.end.offset;
          // Escapes/entities have non-linear source positions. Leave those nodes intact.
          if (from === undefined || to === undefined || source.slice(from, to) !== child.value) {
            flush();
            return;
          }
          run.text += child.value;
          for (let index = from; index < to; index++)
            run.positions.push({ from: index, to: index + 1, segment: from });
        } else if (["strong", "emphasis", "delete", "link"].includes(child.type))
          child.children?.forEach(inline);
        else flush();
      }
      node.children?.forEach(inline);
      flush();
    } else node.children?.forEach(block);
  }
  block(markdownTree(source));
  return runs;
}

/** Split a text replacement over text leaves, retaining the existing inline marks/syntax. */
export function distributeChange(run: TextRun, range: Range, replacement: string): TextChange[] {
  const positions = run.positions.slice(range.from, range.to);
  const segments: (Range & { segment?: number })[] = [];
  for (const position of positions) {
    const previous = segments.at(-1);
    if (previous?.to === position.from && previous.segment === position.segment)
      previous.to = position.to;
    else segments.push({ ...position });
  }
  const pieces = Array.from(replacement);
  let cursor = 0;
  return segments.map((segment, index) => {
    const remainingSegments = segments.length - index - 1;
    const count =
      index === segments.length - 1
        ? pieces.length - cursor
        : Math.max(
            0,
            Math.min(segment.to - segment.from, pieces.length - cursor - remainingSegments),
          );
    const text = pieces.slice(cursor, cursor + count).join("");
    cursor += count;
    return { ...segment, text };
  });
}
export function dictionaryChanges(
  runs: TextRun[],
  entries: VocabularyEntry[],
  selection?: Range,
): TextChange[] {
  const choices = entries
    .filter((entry) => entry.enabled)
    .flatMap((entry) =>
      [entry.canonical, ...entry.aliases].map((phrase) => ({
        phrase,
        canonical: entry.canonical,
        pattern: new RegExp(`^${escape(phrase)}`, "iu"),
      })),
    )
    .sort(
      (a, b) =>
        new TextEncoder().encode(b.phrase).length - new TextEncoder().encode(a.phrase).length,
    );
  const changes: TextChange[] = [];
  if (!choices.length) return changes;
  const expression = new RegExp(choices.map((choice) => escape(choice.phrase)).join("|"), "giu");
  for (const run of runs) {
    for (let cursor = 0; cursor < run.text.length;) {
      expression.lastIndex = cursor;
      const next = expression.exec(run.text);
      if (!next) break;
      cursor = next.index;
      if (word(before(run.text, cursor))) {
        cursor += after(run.text, cursor).length;
        continue;
      }
      const choice = choices.find((candidate) => {
        const match = candidate.pattern.exec(run.text.slice(cursor));
        return match && bounded(run.text, cursor, cursor + match[0].length);
      });
      if (!choice) {
        cursor += after(run.text, cursor).length;
        continue;
      }
      const length = choice.pattern.exec(run.text.slice(cursor))![0].length;
      const range = { from: cursor, to: cursor + length };
      const positions = {
        from: run.positions[cursor].from,
        to: run.positions[cursor + length - 1].to,
      };
      if (
        (!selection || (positions.from >= selection.from && positions.to <= selection.to)) &&
        run.text.slice(cursor, cursor + length) !== choice.canonical
      )
        changes.push(...distributeChange(run, range, choice.canonical));
      cursor += length;
    }
  }
  return changes;
}
/** Drop only formatting wrappers emptied by a reviewed source dictionary action. */
export function sourceDictionaryChanges(
  source: string,
  entries: VocabularyEntry[],
  selection?: Range,
): TextChange[] {
  let changes = dictionaryChanges(sourceTextRuns(source), entries, selection);
  function visit(node: Ast) {
    node.children?.forEach(visit);
    if (!["strong", "emphasis", "delete"].includes(node.type)) return;
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
    const within = changes.filter((change) => change.from >= from && change.to <= to);
    if (!within.length) return;
    const changed = applySourceChanges(
      source.slice(from, to),
      within.map((change) => ({ ...change, from: change.from - from, to: change.to - from })),
    );
    const marker = node.type === "strong" || node.type === "delete" ? 2 : 1;
    if (changed.length === marker * 2)
      changes = [...changes.filter((change) => !within.includes(change)), { from, to, text: "" }];
  }
  visit(markdownTree(source));
  return changes;
}
export function applySourceChanges(source: string, changes: TextChange[]): string {
  return [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (value, change) => value.slice(0, change.from) + change.text + value.slice(change.to),
      source,
    );
}
export function applyVisualChanges(editor: Editor, changes: TextChange[]) {
  let transaction = closeHistory(editor.state.tr);
  for (const change of [...changes].sort((a, b) => b.from - a.from))
    transaction = transaction.insertText(change.text, change.from, change.to);
  editor.view.dispatch(transaction);
  editor.view.dispatch(closeHistory(editor.state.tr));
}
export function validTerm(value: string) {
  return (
    value.trim().length > 0 && Array.from(value.trim()).length <= 80 && !/[\p{Cc}]/u.test(value)
  );
}
export function preserveBoundaryWhitespace(original: string, replacement: string) {
  return (
    (original.match(/^\s*/u)?.[0] ?? "") + replacement.trim() + (original.match(/\s*$/u)?.[0] ?? "")
  );
}
export function selectionIsStale(
  captured: { id: string; document: string },
  id: string,
  document: string,
) {
  return captured.id !== id || captured.document !== document;
}
export function canRefineSource(source: string, range: Range): boolean {
  if (range.from >= range.to || !source.slice(range.from, range.to).trim()) return false;
  let valid = true;
  function visit(node: Ast) {
    const from = node.position?.start.offset ?? 0;
    const to = node.position?.end.offset ?? 0;
    if (to <= range.from || from >= range.to) return;
    if (
      ["table", "code", "inlineCode", "html", "definition", "image", "linkReference"].includes(
        node.type,
      )
    )
      valid = false;
    if (
      ["strong", "emphasis", "delete", "link"].includes(node.type) &&
      (range.from > from || range.to < to)
    )
      valid = false;
    node.children?.forEach(visit);
  }
  visit(markdownTree(source));
  return valid;
}
export function selectionMarkdown(editor: Editor, range: Range): string | null {
  const { doc } = editor.state;
  if (range.from >= range.to || !doc.textBetween(range.from, range.to).trim()) return null;
  let valid = true;
  doc.nodesBetween(range.from, range.to, (node) => {
    if (["table", "codeBlock"].includes(node.type.name)) valid = false;
  });
  if (!valid) return null;
  return editor.markdown!.serialize({
    type: "doc",
    content: doc.slice(range.from, range.to).content.toJSON(),
  } as JSONContent);
}
