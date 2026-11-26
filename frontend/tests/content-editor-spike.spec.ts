import { expect, test } from "@playwright/test";

test("editor compatibility preserves structures and exact original Markdown outside mutations", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/tests/content-editor-probe.ts";
    const core = await import(path);
    const editor = new core.Editor({
      extensions: core.editorExtensions(),
      content: "",
      contentType: "markdown",
    });
    const supported = [
      "# Heading\n\nHello **bold** and *italic*, ~~strike~~ and `code`.\n\n---",
      "- first\n  - nested\n- second\n\n1. One\n2. Two",
      "- [x] done\n- [ ] pending",
      "| Name | Count |\n| :--- | ---: |\n| Alice | 3 |",
      "> Quote\n\n[Label](https://example.com) and citation [1].\n\n```ts\nconst n = 2;\n```",
      "Repeated **phrase**. Repeated phrase. Grüße 👩🏽‍💻 σ ς K ſ.",
    ];
    const compatibility = supported.map((source) => ({
      source,
      supported: core.visualCompatibility(source, editor),
    }));
    const fallback = [
      "<!-- keep -->\n\nText",
      "![image](photo.png)",
      "[link][ref]\n\n[ref]: https://example.com",
      "<details>Keep me</details>",
    ].map((source) => core.visualCompatibility(source, editor));
    editor.commands.setContent("first **post**gres and postgres", {
      contentType: "markdown",
      emitUpdate: false,
    });
    const original = editor.getMarkdown();
    const changes = core.dictionaryChanges(core.visualTextRuns(editor.state.doc, true), [
      { id: "term", canonical: "PostgreSQL", aliases: ["postgres"], enabled: true },
    ]);
    core.applyVisualChanges(editor, changes);
    const applied = editor.getMarkdown();
    editor.commands.undo();
    const undone = editor.getMarkdown();
    editor.commands.setContent("Cited **text** [[1]].", {
      contentType: "markdown",
      emitUpdate: false,
    });
    editor.commands.insertContentAt(1, "Edited ");
    const citation = core.serializeMarkdown(editor, editor.state.doc, "Cited **text** [[1]].");
    const groupedSource =
      "Grouped [[1, 2]] and [[1], [2]]. Code `[[1, 2]]` and [source](https://example.com/[[1]]).";
    editor.commands.setContent(groupedSource, { contentType: "markdown", emitUpdate: false });
    editor.commands.insertContentAt(1, "Edited ");
    const groupedCitations = core.serializeMarkdown(editor, editor.state.doc, groupedSource);
    editor.destroy();
    return { compatibility, fallback, original, applied, undone, citation, groupedCitations };
  });
  expect(result.compatibility.filter((item) => !item.supported)).toEqual([]);
  expect(result.fallback).toEqual([false, false, false, false]);
  expect(result.applied).toContain("PostgreSQL");
  expect(result.undone).toBe(result.original);
  expect(result.citation).toContain("[[1]]");
  expect(result.groupedCitations).toContain("Grouped [[1, 2]] and [[1], [2]].");
  expect(result.groupedCitations).toContain("`[[1, 2]]`");
  expect(result.groupedCitations).toContain("https://example.com/[[1]]");
});

test("source dictionary uses AST ranges and Unicode simple folding without cascading", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/tests/content-editor-probe.ts";
    const core = await import(path);
    const entries = [
      { id: "pg", canonical: "PG", aliases: ["postgres"], enabled: true },
      { id: "s", canonical: "Science", aliases: [], enabled: true },
      { id: "short", canonical: "Red", aliases: [], enabled: true },
      { id: "long", canonical: "Fedora", aliases: ["red hat"], enabled: true },
      { id: "no", canonical: "New", aliases: ["old"], enabled: false },
    ];
    const source =
      "<!-- postgres -->\n\npost**gres**, `postgres`, [postgres](https://postgres.example), https://postgres.example, ſcience. red hatchet red hat old xpostgres Äpostgres.";
    const changed = core.applySourceChanges(source, core.sourceDictionaryChanges(source, entries));
    const staleness = [
      core.selectionIsStale({ id: "one", document: "x" }, "one", "x"),
      core.selectionIsStale({ id: "one", document: "x" }, "two", "x"),
      core.selectionIsStale({ id: "one", document: "x" }, "one", "y"),
    ];
    const start = performance.now();
    const large = "ordinary text ".repeat(7142);
    core.sourceDictionaryChanges(large, entries);
    const elapsed = performance.now() - start;
    return { changed, staleness, elapsed };
  });
  expect(result.changed).toBe(
    "<!-- postgres -->\n\nP**G**, `postgres`, [PG](https://postgres.example), https://postgres.example, Science. Red hatchet Fedora old xpostgres Äpostgres.",
  );
  expect(result.staleness).toEqual([false, true, true]);
  expect(result.elapsed).toBeLessThan(5000);
});

test("citation escapes use backslash parity and ambiguous occurrences stay in source", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/tests/content-editor-probe.ts";
    const core = await import(path);
    const editor = new core.Editor({
      extensions: core.editorExtensions(),
      content: "",
      contentType: "markdown",
    });
    const even = [0, 2, 4].map((count) => {
      const source = "Value " + "\\".repeat(count) + "[[1]].";
      const compatible = core.visualCompatibility(source, editor);
      editor.commands.setContent(source, { contentType: "markdown", emitUpdate: false });
      editor.commands.insertContentAt(1, "Edited ");
      return {
        source,
        compatible,
        edited: core.serializeMarkdown(editor, editor.state.doc, source),
      };
    });
    const literal = String.raw`\[\[1\]\]`;
    const ambiguous = [
      `Active [[1]]. Literal ${literal}.`,
      `Literal ${literal}. Active [[1]].`,
      String.raw`Odd \[[1]].`,
      String.raw`Odd \\\[[1]].`,
      String.raw`Grouped [[1, 2]]. Literal \[\[1, 2\]\].`,
    ].map((source) => {
      const compatible = core.visualCompatibility(source, editor);
      // Deliberately bypass the UI gate to prove the adapter does not invent occurrence identities.
      editor.commands.setContent(source, { contentType: "markdown", emitUpdate: false });
      editor.commands.insertContentAt(1, "Edited ");
      return {
        compatible,
        regular: editor.getMarkdown(),
        adapted: core.serializeMarkdown(editor, editor.state.doc, source),
      };
    });
    const protectedSource =
      "Real [[1]]. Code `" + literal + "` and [Source](https://example.com/[[1]]).";
    const protectedCompatible = core.visualCompatibility(protectedSource, editor);
    editor.commands.setContent(protectedSource, { contentType: "markdown", emitUpdate: false });
    editor.commands.insertContentAt(1, "Edited ");
    const protectedEdited = core.serializeMarkdown(editor, editor.state.doc, protectedSource);
    const repeatedSources = [
      `Real [[1]]. Literal ${literal}. Real [[1]].`,
      `Literal ${literal}. Real [[1]]. Real [[1]].`,
    ];
    const repeated = repeatedSources.map((source, index) => {
      editor.commands.setContent(source, { contentType: "markdown", emitUpdate: false });
      const ranges = core.mappedMatches(core.visualTextRuns(editor.state.doc), "[[1]]");
      const live = index === 0 ? [ranges[0], ranges[2]] : [ranges[1], ranges[2]];
      core.applyVisualChanges(
        editor,
        live.map((range) => ({ ...range, text: "" })),
      );
      const deleted = core.serializeMarkdown(editor, editor.state.doc, source);
      const deletedRegular = editor.getMarkdown();
      editor.commands.insertContentAt(1, "[[1]] ");
      const inserted = core.serializeMarkdown(editor, editor.state.doc, source);
      const insertedRegular = editor.getMarkdown();
      const current = core.mappedMatches(core.visualTextRuns(editor.state.doc), "[[1]]");
      core.applyVisualChanges(editor, [{ ...current[0], text: "" }]);
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " [[1]]");
      return {
        deleted,
        deletedRegular,
        inserted,
        insertedRegular,
        reordered: core.serializeMarkdown(editor, editor.state.doc, source),
        reorderedRegular: editor.getMarkdown(),
      };
    });
    editor.destroy();
    return { even, ambiguous, protectedCompatible, protectedEdited, literal, repeated };
  });
  expect(result.even.every((item) => item.compatible)).toBe(true);
  for (const item of result.even) expect(item.edited).toBe("Edited " + item.source);
  expect(result.ambiguous.every((item) => !item.compatible)).toBe(true);
  for (const item of result.ambiguous) expect(item.adapted).toBe(item.regular);
  expect(result.protectedCompatible).toBe(true);
  expect(result.protectedEdited).toContain("Real [[1]].");
  expect(result.protectedEdited).toContain("`" + result.literal + "`");
  expect(result.protectedEdited).toContain("https://example.com/[[1]]");
  for (const item of result.repeated) {
    expect(item.deleted).toBe(item.deletedRegular);
    expect(item.inserted).toBe(item.insertedRegular);
    expect(item.reordered).toBe(item.reorderedRegular);
    expect(item.deleted).not.toContain("[[1]]");
    expect(item.inserted).not.toContain("[[1]]");
    expect(item.reordered).not.toContain("[[1]]");
  }
});
