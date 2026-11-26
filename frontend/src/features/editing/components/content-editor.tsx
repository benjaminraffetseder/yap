import { ActionMenu, ActionMenuItem, ActionMenuSub } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDictationActivity,
  useSavedConfiguration,
  useSavedVocabulary,
} from "@/features/dictation/hooks/use-dictation-state";
import {
  useTextRequest,
  type TextRequestOutcome,
} from "@/features/processing/hooks/use-text-request";
import { CorrectionForm } from "@/features/transcripts/components/correction-form";
import { TranscriptDiff } from "@/features/transcripts/components/transcript-diff";
import { backend, message } from "@/lib/backend";
import { useSavedActions } from "@/lib/queries/saved-queries";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  CaseSensitive,
  Code,
  CodeXml,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  Redo2,
  Search,
  SpellCheck,
  Strikethrough,
  Table2,
  Undo2,
  WandSparkles,
  WholeWord,
  X,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  applySourceChanges,
  applyVisualChanges,
  canRefineSource,
  dictionaryChanges,
  editorExtensions,
  findText,
  isGfmDocument,
  mappedMatches,
  normalizeTableHeaders,
  preserveBoundaryWhitespace,
  searchPluginKey,
  selectionIsStale,
  selectionMarkdown,
  serializeMarkdown,
  sourceDictionaryChanges,
  validTerm,
  visualCompatibility,
  visualTextRuns,
  type Range,
  type TextChange,
} from "../lib/editor-document";
import { SourceEditor, type SourceEditorHandle } from "./source-editor";

export type ContentEditorHandle = { focus: () => void; openSearch: () => void };
export type ContentEditorProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  onSave?: () => void;
  onClose?: () => void;
  autoFocus?: boolean;
  readOnly?: boolean;
  onAddToVocabulary?: (selected: string) => void;
};
type Mode = "visual" | "source";
type Capture = {
  id: string;
  document: string;
  version: number;
  mode: Mode;
  range: Range;
  input: string;
  plain: string;
  before: string;
  after: string;
  inline: boolean;
};
type DictionaryPreview = {
  id: string;
  document: string;
  version: number;
  mode: Mode;
  dictionary: string;
  changes: TextChange[];
  before: string;
  after: string;
};
const presets = ["concise", "proofread", "rewrite", "friendly", "professional", "summary"] as const;
type Preset = (typeof presets)[number];
const limit = 100_000;
const visualEditorClasses = [
  "min-h-60 p-4 leading-[1.75] whitespace-pre-wrap outline-none outline-current [overflow-wrap:anywhere]",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring",
  "[&>*+*]:mt-[0.75em]",
  "[&_h1]:text-[1.8em] [&_h1]:leading-[1.35] [&_h1]:font-[650]",
  "[&_h2]:text-[1.5em] [&_h2]:leading-[1.4] [&_h2]:font-[650]",
  "[&_h3]:text-[1.25em] [&_:is(h3,h4,h5,h6)]:font-[650]",
  "[&_ul]:list-disc [&_ul]:ps-[1.5em] [&_ol]:list-decimal [&_ol]:ps-[1.5em] [&_li>p]:m-0",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:ps-0",
  "[&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-baseline [&_li[data-type=taskItem]]:gap-[0.6em]",
  "[&_li[data-type=taskItem]>div]:min-w-0 [&_li[data-type=taskItem]>div]:flex-1",
  "[&_blockquote]:border-s-[3px] [&_blockquote]:border-s-border [&_blockquote]:ps-[1em] [&_blockquote]:text-muted-foreground",
  "[&_pre]:overflow-auto [&_pre]:rounded-[0.5rem] [&_pre]:bg-muted [&_pre]:p-[0.75em]",
  "[&_code]:rounded-[0.2em] [&_code]:bg-muted [&_code]:px-[0.25em] [&_code]:py-[0.1em] [&_code]:font-mono [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_hr]:my-[1.25em] [&_hr]:border-border",
  "[&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse",
  "[&_:is(td,th)]:relative [&_:is(td,th)]:min-w-[3em] [&_:is(td,th)]:border [&_:is(td,th)]:border-border",
  "[&_:is(td,th)]:px-[0.65em] [&_:is(td,th)]:py-[0.4em] [&_:is(td,th)]:align-top",
  "[&_th]:font-semibold [&_th:not(.selectedCell)]:bg-muted [&_.selectedCell]:bg-accent",
].join(" ");
const visible = (element: HTMLElement | null) =>
  element &&
  !element.closest("[hidden],[inert],[aria-hidden=true]") &&
  element.getClientRects().length > 0;
const contextTail = (value: string) => Array.from(value).slice(-2000).join("");
const contextHead = (value: string) => Array.from(value).slice(0, 2000).join("");

/** Parent owns the one Markdown draft and saving. Matching receipts never replace editor state. */
export const ContentEditor = forwardRef<ContentEditorHandle, ContentEditorProps>(
  function ContentEditor(props, ref) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const configuration = useSavedConfiguration();
    const vocabulary = useSavedVocabulary();
    const activity = useDictationActivity();
    const savedActions = useSavedActions();
    const request = useTextRequest();
    const root = useRef<HTMLDivElement>(null);
    const source = useRef<SourceEditorHandle>(null);
    const searchInput = useRef<HTMLInputElement>(null);
    const current = useRef({ id: props.id, value: props.value, version: 0 });
    const latest = useRef(props);
    latest.current = props;
    const modeRef = useRef<Mode>("visual");
    const [mode, setMode] = useState<Mode>("visual");
    const [document, setDocument] = useState(props.value);
    const [notice, setNotice] = useState("");
    const [, setSelectionVersion] = useState(0);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [active, setActive] = useState(0);
    const [remember, setRemember] = useState(false);
    const [rememberPending, setRememberPending] = useState(false);
    const [dictionary, setDictionary] = useState<DictionaryPreview | null>(null);
    const [capture, setCapture] = useState<Capture | null>(null);
    const contextSelection = useRef<Capture | null>(null);
    const [menuSelection, setMenuSelection] = useState<Capture | null>(null);
    const [refineOpen, setRefineOpen] = useState(false);
    const [preset, setPreset] = useState<Preset>("proofread");
    const [result, setResult] = useState("");
    const [previewError, setPreviewError] = useState("");
    const refinementRun = useRef<{ cancelled: boolean } | null>(null);
    const [correction, setCorrection] = useState<Capture | null>(null);
    const [correctionPending, setCorrectionPending] = useState(false);
    const [link, setLink] = useState<{ capture: Capture; address: string } | null>(null);
    const history = useRef<{ undo: string[]; redo: string[]; typedAt: number }>({
      undo: [],
      redo: [],
      typedAt: 0,
    });
    const actionBoundary = useRef(false);
    const suppressed = useRef(false);
    const editable = !props.disabled && !props.readOnly;
    const extensions = useMemo(editorExtensions, []);
    const editorProps = useMemo(
      () => ({
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": props.label,
          id: mode === "visual" ? props.id : `${props.id}-visual`,
          "aria-invalid": props.invalid ? "true" : "false",
          ...(props.describedBy ? { "aria-describedby": props.describedBy } : {}),
          class: visualEditorClasses,
        },
      }),
      [mode, props.id, props.label, props.invalid, props.describedBy],
    );
    const editor = useEditor({
      extensions,
      // Unsupported source must pass the compatibility gate before the visual parser sees it.
      content: "",
      contentType: "markdown",
      editable,
      immediatelyRender: true,
      editorProps,
      onUpdate: ({ editor, transaction }) => {
        if (suppressed.current || !transaction.docChanged) return;
        change(
          serializeMarkdown(editor, editor.state.doc, current.current.value),
          !actionBoundary.current &&
            transaction.steps.every((step) => step.toJSON().stepType === "replace"),
        );
      },
      onSelectionUpdate: () => setSelectionVersion((value) => value + 1),
    });
    const editorRef = useRef<Editor | null>(editor);
    editorRef.current = editor;

    function change(value: string, typing = false) {
      if (
        value === current.current.value ||
        !latest.current ||
        latest.current.readOnly ||
        latest.current.disabled
      )
        return;
      const previous = current.current.value;
      const now = Date.now();
      if (!typing || now - history.current.typedAt > 500 || !history.current.undo.length)
        history.current.undo.push(previous);
      if (history.current.undo.length > 100) history.current.undo.shift();
      history.current.typedAt = typing ? now : 0;
      history.current.redo = [];
      current.current = { ...current.current, value, version: current.current.version + 1 };
      setDocument(value);
      latest.current.onChange(value);
    }
    function setVisual(value: string) {
      const instance = editorRef.current;
      if (!instance || instance.isDestroyed) return;
      suppressed.current = true;
      try {
        instance.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
      } finally {
        suppressed.current = false;
      }
    }
    function load(value: string, notify: boolean) {
      current.current = { ...current.current, value, version: current.current.version + 1 };
      setDocument(value);
      source.current?.setValue(value);
      const instance = editorRef.current;
      if (instance && visualCompatibility(value, instance)) setVisual(value);
      else {
        modeRef.current = "source";
        setMode("source");
      }
      if (notify) latest.current.onChange(value);
    }
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      if (!visualCompatibility(current.current.value, editor)) {
        modeRef.current = "source";
        setMode("source");
      } else {
        setVisual(current.current.value);
        editor.commands.setTextSelection(0);
      }
      if (props.autoFocus) requestAnimationFrame(() => focus());
      // Initial parse never becomes a write, even if its representation is normalized.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor]);
    useEffect(() => {
      if (props.id === current.current.id && props.value === current.current.value) return;
      const sameDocument = props.id === current.current.id;
      current.current.id = props.id;
      history.current = { undo: [], redo: [], typedAt: 0 };
      load(props.value, false);
      if (sameDocument) setNotice(t("contentEditor.externalChange"));
      // Owner-driven restoration/reconciliation is intentional; matching save receipts take the fast path above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.id, props.value]);
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(editable, false);
    }, [editor, editable]);
    function focus() {
      if (modeRef.current === "source") source.current?.focus();
      else {
        const instance = editorRef.current;
        if (instance && !instance.isDestroyed) instance.commands.focus();
      }
    }
    function openSearch() {
      if (!visible(root.current)) return;
      setSearchOpen(true);
      requestAnimationFrame(() => {
        searchInput.current?.focus();
        searchInput.current?.select();
      });
    }
    useImperativeHandle(ref, () => ({ focus, openSearch }));
    function switchMode(next: Mode) {
      if (next === modeRef.current || !editor) return;
      if (next === "visual") {
        if (!visualCompatibility(current.current.value, editor)) {
          setNotice(t("contentEditor.visualBlocked"));
          return;
        }
        setVisual(current.current.value);
      } else source.current?.setValue(current.current.value);
      history.current.typedAt = 0;
      modeRef.current = next;
      setMode(next);
      setActive(0);
      requestAnimationFrame(focus);
    }
    function undo(redo = false) {
      if (!editable) return;
      const from = redo ? history.current.redo : history.current.undo;
      const to = redo ? history.current.undo : history.current.redo;
      const previous = from.pop();
      if (previous === undefined) return;
      to.push(current.current.value);
      history.current.typedAt = 0;
      load(previous, true);
      focus();
    }
    function action(run: () => void) {
      if (!editable) return;
      actionBoundary.current = true;
      history.current.typedAt = 0;
      try {
        run();
      } finally {
        actionBoundary.current = false;
        history.current.typedAt = 0;
      }
    }
    const visualDocument = editor?.state.doc;
    const runs = useMemo(
      () => (visualDocument && mode === "visual" ? visualTextRuns(visualDocument) : []),
      [visualDocument, mode],
    );
    const matches = useMemo(
      () =>
        mode === "source"
          ? findText(document, query, caseSensitive, wholeWord)
          : mappedMatches(runs, query, caseSensitive, wholeWord),
      [mode, document, query, caseSensitive, wholeWord, runs],
    );
    const currentMatch = matches.length ? Math.min(active, matches.length - 1) : -1;
    useEffect(() => {
      const ranges = searchOpen ? matches : [];
      source.current?.highlight(mode === "source" ? ranges : [], currentMatch);
      if (editor)
        editor.view.dispatch(
          editor.state.tr.setMeta(searchPluginKey, {
            ranges: mode === "visual" ? ranges : [],
            active: currentMatch,
          }),
        );
    }, [editor, matches, currentMatch, searchOpen, mode]);
    function reveal(index: number) {
      if (!matches.length || !editor) return;
      const next = (index + matches.length) % matches.length;
      const range = matches[next];
      setActive(next);
      if (mode === "source") source.current?.reveal(range);
      else {
        editor.view.dispatch(
          editor.state.tr
            .setSelection(TextSelection.create(editor.state.doc, range.from, range.to))
            .scrollIntoView(),
        );
      }
      requestAnimationFrame(() =>
        root.current
          ?.querySelector('[data-editor-search-match="current"]')
          ?.scrollIntoView({ block: "nearest" }),
      );
    }
    function replaceChanges(changes: TextChange[]): boolean {
      if (!editor || !changes.length || !editable) return false;
      let next: string;
      if (modeRef.current === "source") next = applySourceChanges(current.current.value, changes);
      else {
        let transaction = editor.state.tr;
        for (const item of [...changes].sort((a, b) => b.from - a.from))
          transaction = transaction.insertText(item.text, item.from, item.to);
        next = serializeMarkdown(editor, transaction.doc, current.current.value);
      }
      if (Array.from(next).length > limit) {
        setNotice(t("contentEditor.documentLimit"));
        return false;
      }
      action(() => {
        if (modeRef.current === "source") source.current?.replace(changes);
        else applyVisualChanges(editor, changes);
      });
      return true;
    }
    async function replace(all: boolean) {
      const ranges = all ? matches : currentMatch >= 0 ? [matches[currentMatch]] : [];
      if (!ranges.length || !editable || rememberPending) return;
      if (!replaceChanges(ranges.map((range) => ({ ...range, text: replacement })))) return;
      if (remember && validTerm(query) && validTerm(replacement)) {
        setRememberPending(true);
        setNotice("");
        try {
          await savedActions.addVocabularyTerm(replacement.trim(), [query.trim()]);
          setNotice(t("contentEditor.remembered"));
        } catch (error) {
          setNotice(t("contentEditor.rememberFailed", { error: message(error) }));
        } finally {
          setRememberPending(false);
        }
      }
    }
    function selected(): Range {
      if (modeRef.current === "source") return source.current?.selection() ?? { from: 0, to: 0 };
      const instance = editorRef.current;
      const selection = window.getSelection();
      if (
        instance &&
        selection?.anchorNode &&
        selection.focusNode &&
        instance.view.dom.contains(selection.anchorNode) &&
        instance.view.dom.contains(selection.focusNode)
      ) {
        try {
          const anchor = instance.view.posAtDOM(selection.anchorNode, selection.anchorOffset);
          const head = instance.view.posAtDOM(selection.focusNode, selection.focusOffset);
          return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
        } catch {
          /* A composition can temporarily leave the DOM without a mapped position. */
        }
      }
      return instance?.state.selection ?? { from: 0, to: 0 };
    }
    function captureSelection(): Capture | null {
      const instance = editorRef.current;
      if (!instance) return null;
      const range = selected();
      if (range.from === range.to) return null;
      const raw = current.current.value;
      const sourceMode = modeRef.current === "source";
      const input = sourceMode
        ? raw.slice(range.from, range.to)
        : selectionMarkdown(instance, range);
      const plain = sourceMode
        ? raw.slice(range.from, range.to)
        : instance.state.doc.textBetween(range.from, range.to, "\n");
      return {
        id: current.current.id,
        document: raw,
        version: current.current.version,
        mode: modeRef.current,
        range: { from: range.from, to: range.to },
        input: input ?? "",
        plain,
        before: contextTail(
          sourceMode
            ? raw.slice(0, range.from)
            : instance.state.doc.textBetween(0, range.from, "\n"),
        ),
        after: contextHead(
          sourceMode
            ? raw.slice(range.to)
            : instance.state.doc.textBetween(range.to, instance.state.doc.content.size, "\n"),
        ),
        inline:
          !sourceMode &&
          instance.state.doc.resolve(range.from).sameParent(instance.state.doc.resolve(range.to)),
      };
    }
    const currentSelection = selected();
    function previewDictionary(selectionOnly: boolean) {
      if (!editor || !editable) return;
      const range = selected();
      if (selectionOnly && range.from === range.to) {
        setNotice(t("contentEditor.selectText"));
        return;
      }
      const changes =
        mode === "source"
          ? sourceDictionaryChanges(document, vocabulary, selectionOnly ? range : undefined)
          : dictionaryChanges(
              visualTextRuns(editor.state.doc, true),
              vocabulary,
              selectionOnly ? range : undefined,
            );
      let after: string;
      if (mode === "source") after = applySourceChanges(document, changes);
      else {
        let transaction = editor.state.tr;
        for (const item of [...changes].sort((a, b) => b.from - a.from))
          transaction = transaction.insertText(item.text, item.from, item.to);
        after = serializeMarkdown(editor, transaction.doc, document);
      }
      setDictionary({
        id: props.id,
        document,
        version: current.current.version,
        mode,
        dictionary: JSON.stringify(vocabulary),
        changes,
        before: document,
        after,
      });
    }
    function stale(snapshot: { id: string; document: string; version: number; mode: Mode }) {
      return (
        selectionIsStale(snapshot, current.current.id, current.current.value) ||
        snapshot.version !== current.current.version ||
        snapshot.mode !== modeRef.current
      );
    }
    function startRefine(nextPreset: Preset, captured = captureSelection()) {
      if (!editable || refinementRun.current || request.pending || busy) return;
      if (!captured) {
        setNotice(t("contentEditor.selectText"));
        return;
      }
      if (
        !captured.input ||
        (captured.mode === "source" && !canRefineSource(captured.document, captured.range))
      ) {
        setNotice(t("contentEditor.unsupportedSelection"));
        return;
      }
      if (!localModel) {
        setNotice(t("contentEditor.modelUnavailable"));
        return;
      }
      setCapture(captured);
      void refine(nextPreset, captured);
    }
    const localModel =
      !!configuration.textProcessing?.model && configuration.textProcessing.enabled;
    const busy =
      activity.phase !== "idle" && activity.phase !== "error" && activity.phase !== "done";
    async function refine(nextPreset = preset, captured = capture) {
      if (!captured || !editable || refinementRun.current || request.pending || !localModel || busy)
        return;
      if (stale(captured)) {
        setNotice(t("contentEditor.staleSelection"));
        return;
      }
      const run = { cancelled: false };
      refinementRun.current = run;
      setPreset(nextPreset);
      setRefineOpen(false);
      setResult("");
      setPreviewError("");
      setNotice("");
      let outcome: TextRequestOutcome | undefined;
      const output = await request.request(
        (id) =>
          backend.refineSelection(id, nextPreset, captured.input, captured.before, captured.after),
        (completed) => {
          outcome = completed;
        },
      );
      refinementRun.current = null;
      if (!root.current || current.current.id !== captured.id || !outcome) return;
      if (run.cancelled || outcome.status === "cancelled") {
        setNotice(t("useTextRequest.processingCancelled"));
        return;
      }
      if (output !== undefined) {
        if (
          !output.trim() ||
          !editor ||
          !visualCompatibility(output, editor) ||
          !editor.schema.nodeFromJSON(editor.markdown!.parse(output)).textContent.trim()
        )
          setPreviewError(t("contentEditor.invalidResult"));
        else
          setResult(
            preserveBoundaryWhitespace(
              captured.mode === "visual" && captured.inline ? captured.plain : captured.input,
              output,
            ),
          );
      }
      setRefineOpen(true);
    }
    async function cancelRefinement() {
      if (refinementRun.current) refinementRun.current.cancelled = true;
      await request.cancel();
    }
    function applyRefinement() {
      if (!capture || !result || !editor || !editable) return;
      if (stale(capture)) {
        setPreviewError(t("contentEditor.staleSelection"));
        return;
      }
      try {
        if (capture.mode === "source") {
          if (!replaceChanges([{ ...capture.range, text: result }])) return;
        } else {
          const parsed = editor.schema.nodeFromJSON(editor.markdown!.parse(result));
          if (!isGfmDocument(parsed)) {
            setPreviewError(t("contentEditor.invalidResult"));
            return;
          }
          const inline =
            capture.inline &&
            parsed.childCount === 1 &&
            parsed.firstChild?.type.name === "paragraph";
          const content = inline ? parsed.firstChild!.content : parsed.content;
          // Paragraph results join the unselected prefix/suffix like a normal paste.
          // Other blocks stay closed so headings and list structure are preserved.
          let open = inline ? 0 : 1;
          if (
            capture.inline &&
            !inline &&
            parsed.content.content.some((node) => node.type.name !== "paragraph")
          )
            open = 0;
          const slice = new Slice(Fragment.from(content), open, open);
          const transaction = editor.state.tr.replaceRange(
            capture.range.from,
            capture.range.to,
            slice,
          );
          if (!isGfmDocument(transaction.doc)) {
            setPreviewError(t("contentEditor.unsupportedSelection"));
            return;
          }
          if (Array.from(serializeMarkdown(editor, transaction.doc, document)).length > limit) {
            setPreviewError(t("contentEditor.documentLimit"));
            return;
          }
          action(() => editor.view.dispatch(transaction));
        }
      } catch {
        setPreviewError(t("contentEditor.unsupportedSelection"));
        return;
      }
      setRefineOpen(false);
      setResult("");
      focus();
    }
    function sourceWrap(open: string, close = open) {
      const range = selected();
      const text = document.slice(range.from, range.to);
      replaceChanges([{ ...range, text: open + text + close }]);
      focus();
    }
    function sourceLines(prefix: string) {
      const range = selected();
      const from = document.lastIndexOf("\n", range.from - 1) + 1;
      const end = document.indexOf("\n", range.to);
      const to = end < 0 ? document.length : end;
      replaceChanges([
        {
          from,
          to,
          text: document
            .slice(from, to)
            .split("\n")
            .map((line) => prefix + line)
            .join("\n"),
        },
      ]);
      focus();
    }
    function format(kind: string) {
      if (!editor || !editable) return;
      if (mode === "source") {
        const wraps: Record<string, [string, string?]> = {
          bold: ["**"],
          italic: ["*"],
          strike: ["~~"],
          code: ["`"],
          codeBlock: ["\n```\n", "\n```\n"],
          divider: ["\n\n---\n\n", ""],
        };
        if (wraps[kind]) sourceWrap(...wraps[kind]);
        else
          sourceLines(
            (
              {
                bulletList: "- ",
                orderedList: "1. ",
                taskList: "- [ ] ",
                blockquote: "> ",
              } as Record<string, string>
            )[kind] ?? "",
          );
        return;
      }
      action(() => {
        const chain = editor.chain().focus();
        switch (kind) {
          case "bold":
            chain.toggleBold().run();
            break;
          case "italic":
            chain.toggleItalic().run();
            break;
          case "strike":
            chain.toggleStrike().run();
            break;
          case "code":
            chain.toggleCode().run();
            break;
          case "bulletList":
            chain.toggleBulletList().run();
            break;
          case "orderedList":
            chain.toggleOrderedList().run();
            break;
          case "taskList":
            chain.toggleTaskList().run();
            break;
          case "blockquote":
            chain.toggleBlockquote().run();
            break;
          case "codeBlock":
            chain.toggleCodeBlock().run();
            break;
          case "divider":
            chain.setHorizontalRule().run();
            break;
        }
      });
    }
    function heading(value: string | null) {
      if (!value || !editor) return;
      if (mode === "source") {
        const range = selected();
        const from = document.lastIndexOf("\n", range.from - 1) + 1;
        const end = document.indexOf("\n", range.to);
        const to = end < 0 ? document.length : end;
        replaceChanges([
          {
            from,
            to,
            text: document
              .slice(from, to)
              .split("\n")
              .map((line) => line.replace(/^#{1,6} /, ""))
              .map((line) => (value === "0" ? "" : "#".repeat(Number(value)) + " ") + line)
              .join("\n"),
          },
        ]);
      } else
        action(() => {
          const chain = editor.chain().focus();
          if (value === "0") chain.setParagraph().run();
          else chain.setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        });
    }
    function openLink() {
      const captured = captureSelection();
      if (!captured) {
        setNotice(t("contentEditor.selectText"));
        return;
      }
      setLink({ capture: captured, address: editor?.getAttributes("link").href ?? "" });
    }
    function applyLink(remove = false) {
      if (!link || !editor || stale(link.capture)) {
        setNotice(t("contentEditor.staleSelection"));
        setLink(null);
        return;
      }
      const address = link.address.trim();
      if (!remove && !/^(https?:\/\/|mailto:|\/|#)/i.test(address)) return;
      if (mode === "source")
        replaceChanges([
          {
            ...link.capture.range,
            text: remove
              ? link.capture.plain
              : `[${link.capture.input}](${address.replace(/[()\s]/g, encodeURIComponent)})`,
          },
        ]);
      else
        action(() => {
          const chain = editor.chain().focus().setTextSelection(link.capture.range);
          if (remove) chain.unsetLink().run();
          else chain.setLink({ href: address }).run();
        });
      setLink(null);
      focus();
    }
    function correct(captured = captureSelection()) {
      if (!captured || !validTerm(captured.plain)) return;
      setCorrection(captured);
      setPreviewError("");
    }
    const tool = (
      label: string,
      icon: ReactNode,
      onClick: () => void,
      activeState = false,
      disabled = !editable,
    ) => (
      <Button
        type="button"
        size="icon-sm"
        variant={activeState ? "secondary" : "ghost"}
        aria-label={label}
        title={label}
        aria-pressed={activeState}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {icon}
      </Button>
    );
    const dictionaryStale =
      dictionary && (stale(dictionary) || dictionary.dictionary !== JSON.stringify(vocabulary));
    const refineStale = capture && stale(capture);

    return (
      <div
        ref={root}
        data-slot="content-editor"
        data-mode={mode}
        className="rounded-lg border bg-background"
        onKeyDownCapture={(event) => {
          if (
            event.nativeEvent.isComposing ||
            !visible(root.current) ||
            !root.current?.contains(event.target as Node)
          )
            return;
          const target = event.target as HTMLElement;
          const inDocument = !!target.closest("[data-content-editor-document]");
          if (inDocument && modeRef.current === "visual" && editor?.view.hasFocus()) {
            const range = selected();
            const selection = editor.state.selection;
            const native = window.getSelection();
            let anchor = range.from,
              head = range.to;
            if (
              native?.anchorNode &&
              editor.view.dom.contains(native.anchorNode) &&
              editor.view.posAtDOM(native.anchorNode, native.anchorOffset) === range.to
            ) {
              anchor = range.to;
              head = range.from;
            }
            if (
              (anchor !== selection.anchor || head !== selection.head) &&
              editor.state.doc.resolve(range.from).parent.inlineContent &&
              editor.state.doc.resolve(range.to).parent.inlineContent
            )
              editor.view.dispatch(
                editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)),
              );
          }
          if (
            inDocument &&
            modeRef.current === "visual" &&
            editor?.view.hasFocus() &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            ["Home", "End"].includes(event.key) &&
            !/Mac/.test(navigator.platform)
          ) {
            const native = window.getSelection();
            if (
              native?.modify &&
              native.anchorNode &&
              native.focusNode &&
              editor.view.dom.contains(native.anchorNode) &&
              editor.view.dom.contains(native.focusNode)
            ) {
              native.modify(
                event.shiftKey ? "extend" : "move",
                event.key === "Home" ? "backward" : "forward",
                "lineboundary",
              );
              editor.view.dispatch(
                editor.state.tr.setSelection(
                  TextSelection.create(
                    editor.state.doc,
                    editor.view.posAtDOM(native.anchorNode, native.anchorOffset),
                    editor.view.posAtDOM(native.focusNode, native.focusOffset),
                  ),
                ),
              );
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "f" &&
            (inDocument || target === root.current)
          ) {
            event.preventDefault();
            event.stopPropagation();
            openSearch();
          } else if (
            inDocument &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "z"
          ) {
            event.preventDefault();
            event.stopPropagation();
            undo(event.shiftKey);
          } else if (
            inDocument &&
            event.ctrlKey &&
            !event.metaKey &&
            event.key.toLowerCase() === "y" &&
            !/Mac/.test(navigator.platform)
          ) {
            event.preventDefault();
            event.stopPropagation();
            undo(true);
          } else if (inDocument && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            if (editable) props.onSave?.();
          } else if (
            inDocument &&
            (event.ctrlKey || event.metaKey) &&
            ["b", "i"].includes(event.key.toLowerCase()) &&
            mode === "source"
          ) {
            event.preventDefault();
            format(event.key.toLowerCase() === "b" ? "bold" : "italic");
          } else if (event.key === "Escape" && searchOpen) {
            event.preventDefault();
            event.stopPropagation();
            setSearchOpen(false);
            focus();
          } else if (
            inDocument &&
            (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
          ) {
            contextSelection.current = captureSelection();
            if (!contextSelection.current) return;
            event.preventDefault();
            event.stopPropagation();
            const trigger = target.closest("[data-content-editor-document]")!;
            const rect = trigger.getBoundingClientRect();
            trigger.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: Math.max(8, Math.min(innerWidth - 8, rect.left + 24)),
                clientY: Math.max(8, Math.min(innerHeight - 8, rect.top + 24)),
              }),
            );
          } else if (inDocument && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onClose?.();
          }
        }}
      >
        <div
          className="sticky top-0 z-30 rounded-[inherit] border-b bg-background [&>:last-child]:border-b-0"
          data-slot="content-editor-toolbar"
        >
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            <div
              className="mr-auto flex min-w-0 max-w-full flex-wrap items-center gap-1"
              aria-label={t("contentEditor.formatting")}
            >
              <Button
                size="sm"
                className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal"
                variant={mode === "visual" ? "secondary" : "ghost"}
                aria-pressed={mode === "visual"}
                onClick={() => switchMode("visual")}
              >
                {t("contentEditor.visual")}
              </Button>
              <Button
                size="sm"
                className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal"
                variant={mode === "source" ? "secondary" : "ghost"}
                aria-pressed={mode === "source"}
                onClick={() => switchMode("source")}
              >
                {t("contentEditor.source")}
              </Button>
            </div>
            {tool(
              t("contentEditor.undo"),
              <Undo2 />,
              () => undo(),
              false,
              !editable || !history.current.undo.length,
            )}
            {tool(
              t("contentEditor.redo"),
              <Redo2 />,
              () => undo(true),
              false,
              !editable || !history.current.redo.length,
            )}
            {tool(t("contentEditor.findInDocument"), <Search />, openSearch, searchOpen, false)}
          </div>
          {!props.readOnly && (
            <div
              className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
              role="group"
              aria-label={t("contentEditor.formatting")}
            >
              <Select
                value={
                  mode === "visual" ? String(editor?.getAttributes("heading").level ?? 0) : "0"
                }
                onValueChange={heading}
                disabled={!editable}
              >
                <SelectTrigger
                  size="sm"
                  className="w-32"
                  aria-label={t("contentEditor.formatting")}
                >
                  <SelectValue>
                    {mode === "visual" && editor?.isActive("heading")
                      ? t("contentEditor.heading", { level: editor.getAttributes("heading").level })
                      : t("contentEditor.paragraph")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t("contentEditor.paragraph")}</SelectItem>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <SelectItem key={level} value={String(level)}>
                      {t("contentEditor.heading", { level })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(
                [
                  ["bold", <Bold />],
                  ["italic", <Italic />],
                  ["bulletList", <List />],
                  ["orderedList", <ListOrdered />],
                ] as const
              ).map(([kind, icon]) => (
                <span key={kind}>
                  {tool(
                    t(`contentEditor.${kind}`),
                    icon,
                    () => format(kind),
                    mode === "visual" && !!editor?.isActive(kind),
                  )}
                </span>
              ))}
              {tool(
                t("contentEditor.link"),
                <Link />,
                openLink,
                mode === "visual" && !!editor?.isActive("link"),
              )}
              <div data-slot="content-editor-more">
                <ActionMenu
                  label={t("contentEditor.moreEditingActions")}
                  disabled={!editable}
                  instant
                >
                  {(
                    [
                      ["strike", <Strikethrough />],
                      ["taskList", <ListChecks />],
                      ["blockquote", <Quote />],
                      ["code", <Code />],
                      ["codeBlock", <CodeXml />],
                      ["divider", <Minus />],
                    ] as const
                  ).map(([kind, icon]) => (
                    <ActionMenuItem key={kind} onClick={() => format(kind)}>
                      {icon}
                      {t(`contentEditor.${kind}`)}
                    </ActionMenuItem>
                  ))}
                  <ActionMenuItem
                    disabled={mode === "source"}
                    onClick={() =>
                      action(() => {
                        editor
                          ?.chain()
                          .focus()
                          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                          .run();
                      })
                    }
                  >
                    <Table2 />
                    {t("contentEditor.insertTable")}
                  </ActionMenuItem>
                  <ActionMenuItem
                    onClick={() => previewDictionary(currentSelection.from !== currentSelection.to)}
                  >
                    <SpellCheck />
                    {t("contentEditor.applyDictionary")}
                  </ActionMenuItem>
                  <ActionMenuSub
                    disabled={
                      currentSelection.from === currentSelection.to || request.pending || busy
                    }
                    label={
                      <>
                        <WandSparkles />
                        {t("contentEditor.refine")}
                      </>
                    }
                  >
                    {presets.map((item) => (
                      <ActionMenuItem
                        key={item}
                        disabled={!localModel}
                        onClick={() => startRefine(item, captureSelection())}
                      >
                        {t(`contentEditor.${item}`)}
                      </ActionMenuItem>
                    ))}
                    {!localModel && (
                      <ActionMenuItem onClick={() => navigate("/prompts")}>
                        {t("contentEditor.modelSetup")}
                      </ActionMenuItem>
                    )}
                  </ActionMenuSub>
                </ActionMenu>
              </div>
            </div>
          )}
          {mode === "visual" && editor?.isActive("table") && editable && (
            <div
              className="flex flex-wrap gap-1 border-b p-2"
              aria-label={t("contentEditor.table")}
            >
              <span className="self-center px-2 text-xs text-muted-foreground">
                {t("contentEditor.headerRequired")}
              </span>
              {(
                [
                  [
                    "addRowBefore",
                    () =>
                      editor
                        .chain()
                        .focus()
                        .addRowBefore()
                        .command(({ tr }) => normalizeTableHeaders(tr))
                        .run(),
                  ],
                  [
                    "addRowAfter",
                    () =>
                      editor
                        .chain()
                        .focus()
                        .addRowAfter()
                        .command(({ tr }) => normalizeTableHeaders(tr))
                        .run(),
                  ],
                  [
                    "deleteRow",
                    () =>
                      editor
                        .chain()
                        .focus()
                        .deleteRow()
                        .command(({ tr }) => normalizeTableHeaders(tr))
                        .run(),
                  ],
                  [
                    "addColumnBefore",
                    () =>
                      editor
                        .chain()
                        .focus()
                        .addColumnBefore()
                        .command(({ tr }) => normalizeTableHeaders(tr))
                        .run(),
                  ],
                  [
                    "addColumnAfter",
                    () =>
                      editor
                        .chain()
                        .focus()
                        .addColumnAfter()
                        .command(({ tr }) => normalizeTableHeaders(tr))
                        .run(),
                  ],
                  [
                    "deleteColumn",
                    () =>
                      editor
                        .chain()
                        .focus()
                        .deleteColumn()
                        .command(({ tr }) => normalizeTableHeaders(tr))
                        .run(),
                  ],
                  ["deleteTable", () => editor.chain().focus().deleteTable().run()],
                ] as const
              ).map(([key, run]) => (
                <Button
                  key={key}
                  size="sm"
                  variant="ghost"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => action(run)}
                >
                  {t(`contentEditor.${key}`)}
                </Button>
              ))}
              {(["left", "center", "right"] as const).map((align) => (
                <Button
                  key={align}
                  size="sm"
                  variant="ghost"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    action(() => {
                      const $from = editor.state.selection.$from;
                      let cellDepth = $from.depth;
                      while (
                        cellDepth > 0 &&
                        !["tableCell", "tableHeader"].includes($from.node(cellDepth).type.name)
                      )
                        cellDepth--;
                      if (!cellDepth) return;
                      const row = $from.node(cellDepth - 1);
                      const column = $from.index(cellDepth - 1);
                      const table = $from.node(cellDepth - 2);
                      let transaction = editor.state.tr;
                      let offset = $from.before(cellDepth - 2) + 1;
                      table.forEach((tableRow) => {
                        let cellOffset = offset + 1;
                        tableRow.forEach((cell, _offset, index) => {
                          if (index === column)
                            transaction = transaction.setNodeMarkup(cellOffset, undefined, {
                              ...cell.attrs,
                              align,
                            });
                          cellOffset += cell.nodeSize;
                        });
                        offset += tableRow.nodeSize;
                      });
                      if (row) editor.view.dispatch(transaction);
                    })
                  }
                >
                  {t(
                    align === "left"
                      ? "contentEditor.alignLeft"
                      : align === "center"
                        ? "contentEditor.alignCenter"
                        : "contentEditor.alignRight",
                  )}
                </Button>
              ))}
            </div>
          )}
          {searchOpen && (
            <div
              className="space-y-2 border-b bg-muted/30 p-3"
              role="search"
              aria-label={t("contentEditor.findInDocument")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  reveal((currentMatch < 0 ? 0 : currentMatch) + (event.shiftKey ? -1 : 1));
                }
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={searchInput}
                  className="h-8 min-w-40 flex-1"
                  aria-label={t("contentEditor.find")}
                  placeholder={t("contentEditor.find")}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                />
                <span className="text-xs tabular-nums" role="status">
                  {t("contentEditor.matchCount", {
                    current: currentMatch + 1,
                    count: matches.length,
                  })}
                </span>
                {tool(
                  t("contentEditor.previousMatch"),
                  <ArrowUp />,
                  () => reveal(currentMatch - 1),
                  false,
                  !matches.length,
                )}
                {tool(
                  t("contentEditor.nextMatch"),
                  <ArrowDown />,
                  () => reveal(currentMatch + 1),
                  false,
                  !matches.length,
                )}
                {tool(
                  t("contentEditor.matchCase"),
                  <CaseSensitive />,
                  () => setCaseSensitive(!caseSensitive),
                  caseSensitive,
                  false,
                )}
                {tool(
                  t("contentEditor.wholeWord"),
                  <WholeWord />,
                  () => setWholeWord(!wholeWord),
                  wholeWord,
                  false,
                )}
                {tool(
                  t("common.close"),
                  <X />,
                  () => {
                    setSearchOpen(false);
                    focus();
                  },
                  false,
                  false,
                )}
              </div>
              {!props.readOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="h-8 min-w-40 flex-1"
                    aria-label={t("contentEditor.replaceWith")}
                    placeholder={t("contentEditor.replaceWith")}
                    value={replacement}
                    disabled={!editable}
                    onChange={(event) => setReplacement(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!editable || !matches.length || rememberPending}
                    onClick={() => void replace(false)}
                  >
                    {t("contentEditor.replace")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!editable || !matches.length || rememberPending}
                    onClick={() => void replace(true)}
                  >
                    {t("contentEditor.replaceAll")}
                  </Button>
                  {validTerm(query) && validTerm(replacement) && (
                    <div className="flex items-center gap-2 text-xs">
                      <Checkbox
                        id={`${props.id}-remember-replacement`}
                        checked={remember}
                        disabled={rememberPending}
                        onCheckedChange={(checked) => setRemember(checked === true)}
                      />
                      <label htmlFor={`${props.id}-remember-replacement`}>
                        {t("contentEditor.rememberReplacement")}
                      </label>
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t(
                  mode === "source"
                    ? "contentEditor.searchScopeSource"
                    : "contentEditor.searchScopeVisual",
                )}
              </p>
            </div>
          )}
          {request.pending && (
            <div
              data-slot="content-editor-refinement"
              className="flex flex-wrap items-center gap-2 px-3 py-2"
            >
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
                {t("contentEditor.generating")} · {t(`contentEditor.${preset}`)}
              </p>
              <Button size="sm" variant="ghost" onClick={() => void cancelRefinement()}>
                {t("contentEditor.cancel")}
              </Button>
              {request.error && (
                <p role="alert" className="text-sm text-destructive">
                  {request.error}
                </p>
              )}
            </div>
          )}
        </div>
        {mode === "source" && editor && !visualCompatibility(document, editor) && (
          <p className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {t("contentEditor.sourceFallback")}
          </p>
        )}
        {notice && (
          <p className="px-3 pt-2 text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        )}
        {Array.from(document).length > limit && (
          <p className="px-3 pt-2 text-sm text-destructive" role="alert">
            {t("contentEditor.documentLimit")}
          </p>
        )}
        <ContextMenu>
          <ContextMenuTrigger
            render={<div data-content-editor-document="" className="select-text!" />}
            onContextMenuCapture={() => {
              contextSelection.current = captureSelection();
              setMenuSelection(contextSelection.current);
            }}
            onContextMenu={(event) => {
              if (!captureSelection()?.plain.trim()) {
                event.preventBaseUIHandler();
                event.stopPropagation();
              }
            }}
          >
            <div hidden={mode !== "visual"}>
              <EditorContent editor={editor} />
            </div>
            <div hidden={mode !== "source"}>
              <SourceEditor
                ref={source}
                id={mode === "source" ? props.id : `${props.id}-source`}
                value={document}
                label={props.label}
                readOnly={!editable}
                invalid={props.invalid}
                describedBy={props.describedBy}
                onChange={change}
                onSelection={() => setSelectionVersion((value) => value + 1)}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!menuSelection?.plain}
              onClick={() => {
                const text = contextSelection.current?.plain;
                if (text) void backend.copy(text).catch((error) => setNotice(message(error)));
              }}
            >
              {t("transcriptMenu.copySelection")}
            </ContextMenuItem>
            <ContextMenuItem onClick={openSearch}>
              {t("contentEditor.findInDocument")}
            </ContextMenuItem>
            {!props.readOnly && (
              <>
                <ContextMenuSub>
                  <ContextMenuSubTrigger
                    disabled={!editable || request.pending || busy}
                    closeDelay={200}
                  >
                    {t("contentEditor.refine")}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    <ContextMenuGroup>
                      {presets.map((item) => (
                        <ContextMenuItem
                          key={item}
                          disabled={!localModel}
                          onClick={() => startRefine(item, contextSelection.current)}
                        >
                          {t(`contentEditor.${item}`)}
                        </ContextMenuItem>
                      ))}
                      {!localModel && (
                        <ContextMenuItem onClick={() => navigate("/prompts")}>
                          {t("contentEditor.modelSetup")}
                        </ContextMenuItem>
                      )}
                    </ContextMenuGroup>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuItem disabled={!editable} onClick={() => previewDictionary(true)}>
                  {t("contentEditor.dictionarySelection")}
                </ContextMenuItem>
                <ContextMenuItem disabled={!editable} onClick={() => previewDictionary(false)}>
                  {t("contentEditor.dictionaryDocument")}
                </ContextMenuItem>
                {validTerm(menuSelection?.plain ?? "") && (
                  <ContextMenuItem
                    disabled={!editable}
                    onClick={() => correct(contextSelection.current)}
                  >
                    {t("correction.correctAndRemember")}
                  </ContextMenuItem>
                )}
                {props.onAddToVocabulary && validTerm(menuSelection?.plain ?? "") && (
                  <ContextMenuItem
                    disabled={!validTerm(menuSelection?.plain ?? "")}
                    onClick={() => {
                      const text = contextSelection.current?.plain;
                      if (text && validTerm(text)) props.onAddToVocabulary?.(text);
                    }}
                  >
                    {t("transcriptEditor.addToVocabulary")}
                  </ContextMenuItem>
                )}
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
        <Dialog
          open={!!dictionary}
          onOpenChange={(open) => {
            if (!open) setDictionary(null);
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t("contentEditor.dictionaryPreview")}</DialogTitle>
              <DialogDescription>{t("contentEditor.dictionaryHelp")}</DialogDescription>
            </DialogHeader>
            {dictionary &&
              (dictionary.changes.length ? (
                <TranscriptDiff before={dictionary.before} after={dictionary.after} />
              ) : (
                <p>{t("contentEditor.dictionaryNoChanges")}</p>
              ))}
            {dictionaryStale && (
              <p role="alert" className="text-destructive">
                {t("contentEditor.dictionaryStale")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDictionary(null)}>
                {t("contentEditor.discard")}
              </Button>
              <Button
                disabled={!dictionary?.changes.length || !!dictionaryStale || !editable}
                onClick={() => {
                  if (dictionary && !dictionaryStale) {
                    replaceChanges(dictionary.changes);
                    setDictionary(null);
                    focus();
                  }
                }}
              >
                {t("contentEditor.apply")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={refineOpen}
          onOpenChange={(open) => {
            if (!open && !request.pending) {
              setRefineOpen(false);
              focus();
            }
          }}
        >
          <DialogContent
            className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
            finalFocus={() => {
              focus();
              return false;
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t("contentEditor.refinePreview")} · {t(`contentEditor.${preset}`)}
              </DialogTitle>
              <DialogDescription>{t("contentEditor.refineHelp")}</DialogDescription>
            </DialogHeader>
            {busy && !request.pending && (
              <p className="text-sm text-muted-foreground">{t("contentEditor.modelBusy")}</p>
            )}
            {result && capture && <TranscriptDiff before={capture.input} after={result} />}
            {(previewError || request.error || refineStale) && (
              <p role="alert" className="text-sm text-destructive">
                {refineStale ? t("contentEditor.staleSelection") : previewError || request.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setRefineOpen(false);
                  focus();
                }}
              >
                {t("contentEditor.discard")}
              </Button>
              <Button
                variant="outline"
                disabled={request.pending || busy || !localModel || !!refineStale}
                onClick={() => void refine()}
              >
                {t("contentEditor.retry")}
              </Button>
              <Button
                disabled={!result || !!previewError || !!refineStale || !editable}
                onClick={applyRefinement}
              >
                {t("contentEditor.apply")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!correction}
          onOpenChange={(open) => {
            if (!open && !correctionPending) setCorrection(null);
          }}
        >
          <DialogContent
            showCloseButton={false}
            finalFocus={() => {
              focus();
              return false;
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {correction && (
              <CorrectionForm
                target={{
                  source: correction.plain,
                  start: correction.plain.length - correction.plain.trimStart().length,
                  end: correction.plain.trimEnd().length,
                  text: correction.plain.trim(),
                }}
                stale={stale(correction)}
                disabled={!editable}
                onPending={setCorrectionPending}
                onCancel={() => setCorrection(null)}
                onDone={() => setCorrection(null)}
                onApply={async (value) => {
                  if (stale(correction) || !editable) return false;
                  return replaceChanges([
                    {
                      ...correction.range,
                      text: preserveBoundaryWhitespace(correction.plain, value),
                    },
                  ]);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!link}
          onOpenChange={(open) => {
            if (!open) setLink(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("contentEditor.link")}</DialogTitle>
              <DialogDescription>{t("contentEditor.linkAddress")}</DialogDescription>
            </DialogHeader>
            <Input
              aria-label={t("contentEditor.linkAddress")}
              value={link?.address ?? ""}
              onChange={(event) =>
                setLink((value) => (value ? { ...value, address: event.target.value } : null))
              }
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => applyLink(true)}>
                {t("contentEditor.removeLink")}
              </Button>
              <Button onClick={() => applyLink()} disabled={!link?.address.trim()}>
                {t("contentEditor.apply")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  },
);
