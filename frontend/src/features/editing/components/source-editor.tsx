import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Range, TextChange } from "../lib/editor-document";
import { searchHighlightAttributes } from "../lib/search-highlight";

const sourceEditorClasses = [
  "[&_.cm-editor]:min-h-60 [&_.cm-editor]:bg-transparent [&_.cm-editor]:text-foreground",
  // Override CodeMirror's unlayered defaults for focus, padding, and colors.
  "[&_.cm-focused]:outline-2! [&_.cm-focused]:-outline-offset-2 [&_.cm-focused]:outline-solid! [&_.cm-focused]:outline-ring!",
  "[&_.cm-content]:p-4! [&_.cm-content]:font-mono [&_.cm-content]:text-[0.875rem] [&_.cm-content]:leading-[1.75] [&_.cm-content]:caret-foreground!",
  "[&_.cm-scroller]:overflow-auto [&_.cm-gutters]:border-border! [&_.cm-gutters]:bg-muted!",
  "[&_.cm-selectionBackground]:bg-accent!",
].join(" ");

const matches = StateEffect.define<{ ranges: Range[]; active: number }>();
const highlights = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(matches))
        value = Decoration.set(
          effect.value.ranges.map((range, index) =>
            Decoration.mark({
              attributes: searchHighlightAttributes(index === effect.value.active),
            }).range(range.from, range.to),
          ),
          true,
        );
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
export type SourceEditorHandle = {
  focus: () => void;
  selection: () => Range;
  reveal: (range: Range) => void;
  setValue: (value: string) => void;
  replace: (changes: TextChange[]) => void;
  highlight: (ranges: Range[], active: number) => void;
};
export const SourceEditor = forwardRef<
  SourceEditorHandle,
  {
    value: string;
    label: string;
    id: string;
    readOnly: boolean;
    invalid?: boolean;
    describedBy?: string;
    onChange: (value: string, typing: boolean) => void;
    onSelection: () => void;
  }
>(function SourceEditor(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const editable = useRef(new Compartment());
  const attributes = useRef(new Compartment());
  useEffect(() => {
    const editor = new EditorView({
      parent: root.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          markdown(),
          keymap.of([...defaultKeymap, indentWithTab]),
          EditorView.lineWrapping,
          highlights,
          editable.current.of([
            EditorState.readOnly.of(latest.current.readOnly),
            EditorView.editable.of(!latest.current.readOnly),
          ]),
          attributes.current.of(
            EditorView.contentAttributes.of({
              role: "textbox",
              "aria-multiline": "true",
              "aria-label": latest.current.label,
              id: latest.current.id,
            }),
          ),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.every(
                (transaction) => transaction.annotation(Transaction.addToHistory) === false,
              )
            )
              latest.current.onChange(
                update.state.doc.toString(),
                update.transactions.some((transaction) => transaction.isUserEvent("input.type")),
              );
            if (update.selectionSet) latest.current.onSelection();
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({
      effects: [
        editable.current.reconfigure([
          EditorState.readOnly.of(props.readOnly),
          EditorView.editable.of(!props.readOnly),
        ]),
        attributes.current.reconfigure(
          EditorView.contentAttributes.of({
            role: "textbox",
            "aria-multiline": "true",
            "aria-label": props.label,
            id: props.id,
            "aria-invalid": props.invalid ? "true" : "false",
            ...(props.describedBy ? { "aria-describedby": props.describedBy } : {}),
          }),
        ),
      ],
    });
  }, [props.readOnly, props.label, props.id, props.invalid, props.describedBy]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => view.current?.focus(),
      selection: () => {
        const range = view.current?.state.selection.main;
        return { from: range?.from ?? 0, to: range?.to ?? 0 };
      },
      reveal: (range) =>
        view.current?.dispatch({
          selection: { anchor: range.from, head: range.to },
          effects: EditorView.scrollIntoView(range.from, { y: "center" }),
        }),
      setValue: (value) => {
        const editor = view.current;
        if (editor && editor.state.doc.toString() !== value)
          editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: value },
            annotations: Transaction.addToHistory.of(false),
          });
      },
      replace: (changes) =>
        view.current?.dispatch({
          changes: changes.map((change) => ({
            from: change.from,
            to: change.to,
            insert: change.text,
          })),
          userEvent: "input.replace",
        }),
      highlight: (ranges, active) =>
        view.current?.dispatch({ effects: matches.of({ ranges, active }) }),
    }),
    [],
  );
  return <div ref={root} className={sourceEditorClasses} />;
});
