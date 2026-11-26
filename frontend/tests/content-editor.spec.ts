import { expect, test, type Page } from "@playwright/test";
import type { VocabularyEntry } from "../src/lib/backend";

async function fixture(
  page: Page,
  value: string,
  options: { readOnly?: boolean; vocabulary?: VocabularyEntry[]; model?: boolean } = {},
) {
  await page.addInitScript(() => localStorage.setItem("desktop-language", "en"));
  await page.goto("/");
  await page.evaluate(
    async ({ value, options }) => {
      const path = "/tests/content-editor-fixture.tsx";
      (await import(path)).mount(value, options);
    },
    { value, options },
  );
  await expect(page.getByRole("textbox", { name: "Fixture document", exact: true })).toBeVisible();
}
async function value(page: Page) {
  return page.evaluate(() => Reflect.get(window, "contentEditorFixture").value as string);
}
async function overflowTool(page: Page, name: string) {
  await page.getByRole("button", { name: "More editing actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function select(page: Page, from: number, to: number) {
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).evaluate(
    (element, { from, to }) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      let offset = 0;
      let anchor: { node: Text; offset: number } | undefined;
      let head = anchor;
      for (const node of nodes) {
        const end = offset + node.length;
        if (!anchor && from < end) anchor = { node, offset: from - offset };
        if (!head && to <= end) head = { node, offset: to - offset };
        offset = end;
      }
      if (!anchor || !head) throw new Error("Missing range");
      (element as HTMLElement).focus();
      const range = document.createRange();
      range.setStart(anchor.node, anchor.offset);
      range.setEnd(head.node, head.offset);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    },
    { from, to },
  );
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).not.toBe("");
}

test("opening, blur, and mode switches preserve raw Markdown and write nothing", async ({
  page,
}) => {
  const raw = "# Heading\n\nKeep __bold__ and  extra spaces.\n";
  await fixture(page, raw);
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).focus();
  await page.getByRole("textbox", { name: "Unrelated field" }).click();
  await page.getByRole("button", { name: "Markdown source", exact: true }).click();
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  expect(await value(page)).toBe(raw);
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").writes)).toEqual([]);
});

test("unsupported syntax stays editable in source and cannot be lost by switching", async ({
  page,
}) => {
  const raw = "<!-- retained -->\n\n![picture](photo.png)\n\nText";
  await fixture(page, raw);
  await expect(page.locator('[data-slot="content-editor"]')).toHaveAttribute("data-mode", "source");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("source has been kept intact");
  const editor = page.getByRole("textbox", { name: "Fixture document", exact: true });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" added");
  expect(await value(page)).toBe(raw + " added");
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
});

test("unsupported mixed GFM opens directly in source without parsing images or executing HTML", async ({
  page,
}) => {
  const raw =
    "# Meeting notes\n\n- [x] Complete\n- [ ] Pending\n\n| Task | Owner |\n| --- | --- |\n| Review | Benji |\n\n```ts\nconst message = 'Hello';\n```\n\n[Unsafe](javascript:alert(1))\n\n<script>window.markdownExecuted = true</script>\n\n![Remote image](https://example.com/private-image.png)";
  const errors: string[] = [],
    images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("private-image.png")) images.push(request.url());
  });
  await fixture(page, raw);
  await expect(page.locator('[data-slot="content-editor"]')).toHaveAttribute("data-mode", "source");
  await expect(page.getByRole("textbox", { name: "Fixture document", exact: true })).toContainText(
    "Meeting notes",
  );
  expect(await value(page)).toBe(raw);
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").writes)).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, "markdownExecuted"))).toBeUndefined();
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("search crosses marks, targets repeated ranges, and Replace All is one undo across modes", async ({
  page,
}) => {
  const raw = "Same **phrase**. Same phrase. Other text.";
  await fixture(page, raw);
  const editor = page.getByRole("textbox", { name: "Fixture document", exact: true });
  await editor.focus();
  await page.keyboard.press("Control+f");
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("Same phrase");
  await expect(page.getByRole("search").getByRole("status")).toHaveText("1 of 2");
  await expect(page.locator("[data-editor-search-match]")).toHaveCount(3);
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  expect(await value(page)).toBe("Changed. Changed. Other text.");
  await page.getByRole("button", { name: "Markdown source", exact: true }).click();
  await editor.focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await editor.focus();
  await page.keyboard.press("Control+Shift+z");
  expect(await value(page)).toBe("Changed. Changed. Other text.");
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").remembered)).toEqual(
    [],
  );
});

test("dictionary preview preserves formatting, code, URLs, Unicode boundaries and rejects stale snapshots", async ({
  page,
}) => {
  const raw =
    "**post**gres and postgres. `postgres` [postgres](https://postgres.example) https://postgres.example xpostgres Åpostgres ſcience.";
  const vocabulary = [
    { id: "pg", canonical: "PostgreSQL", aliases: ["postgres"], enabled: true },
    { id: "science", canonical: "Science", aliases: [], enabled: true },
  ];
  await fixture(page, raw, { vocabulary });
  await overflowTool(page, "Apply dictionary");
  await expect(page.getByRole("dialog")).toContainText("Dictionary preview");
  expect(await value(page)).toBe(raw);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const changed = await value(page);
  expect(changed).toContain("**Post**greSQL and PostgreSQL");
  expect(changed).toContain("`postgres`");
  expect(changed).toContain("https://postgres.example");
  expect(changed).toContain("xpostgres Åpostgres Science");
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
  await overflowTool(page, "Apply dictionary");
  await page.evaluate(() => Reflect.get(window, "contentEditorFixture").dictionary([]));
  await expect(page.getByRole("alert")).toContainText("dictionary changed");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
});

test("refinement applies only the captured repeated selection and is one undo; receipt does not invalidate", async ({
  page,
}) => {
  const raw = "Repeat phrase. Repeat **phrase**. End.";
  await fixture(page, raw);
  await select(page, 15, 28);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Proofread", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await page.evaluate((raw) => Reflect.get(window, "contentEditorFixture").external(raw), raw);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(await value(page)).toBe("Repeat phrase. Refined text. End.");
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
});

test("context refinement exposes all presets and opens the review only after processing finishes", async ({
  page,
}, info) => {
  const raw = "Selected passage. Other text.";
  await fixture(page, raw);
  await page.evaluate(() => {
    Reflect.get(window, "contentEditorFixture").pending = true;
  });
  await select(page, 0, "Selected passage.".length);
  await page.keyboard.press("Shift+F10");
  const refine = page.getByRole("menuitem", { name: "Refine selection", exact: true });
  await refine.hover();
  const submenu = page.locator('[data-slot="context-menu-sub-content"]');
  await expect(submenu.getByRole("menuitem")).toHaveText([
    "Concise",
    "Proofread",
    "Rewrite",
    "Friendly",
    "Professional",
    "Summary",
  ]);
  await page.screenshot({
    path: info.outputPath("refine-presets-submenu.png"),
    animations: "disabled",
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").requested)).toEqual(
    [],
  );
  await submenu.getByRole("menuitem", { name: "Friendly", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Refining selection");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await value(page)).toBe(raw);
  expect(
    await page.evaluate(() => Reflect.get(window, "contentEditorFixture").requested[0].slice(1, 3)),
  ).toEqual(["friendly", "Selected passage."]);
  await page.getByRole("button", { name: "More editing actions", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Refine selection", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    Reflect.get(window, "contentEditorFixture").finish("Improved passage."),
  );
  const dialog = page.getByRole("dialog", { name: "Selection refinement · Friendly", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(dialog).toContainText("Improved passage.");
  expect(await value(page)).toBe(raw);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  expect(await value(page)).toBe("Improved passage. Other text.");
});

test("cancelled refinement never opens a review for a late model reply", async ({ page }) => {
  const raw = "Keep this selection.";
  await fixture(page, raw);
  await page.evaluate(() => {
    const state = Reflect.get(window, "contentEditorFixture");
    state.pending = true;
    state.cancelDeferred = true;
  });
  await select(page, 0, raw.length);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Concise", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.evaluate(() =>
    Reflect.get(window, "contentEditorFixture").finish("Late replacement."),
  );
  await expect(page.getByRole("status")).toContainText("cancelled");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await value(page)).toBe(raw);
});

test("failed refinement opens its error after completion and Retry processes without a dialog", async ({
  page,
}) => {
  const raw = "Selected passage.";
  await fixture(page, raw);
  await page.evaluate(() => {
    Reflect.get(window, "contentEditorFixture").error = "Model unavailable";
  });
  await select(page, 0, raw.length);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Professional", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Selection refinement · Professional",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toHaveText("Model unavailable");
  await page.evaluate(() => {
    const state = Reflect.get(window, "contentEditorFixture");
    state.error = "";
    state.pending = true;
  });
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Refining selection");
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() =>
    Reflect.get(window, "contentEditorFixture").finish("Professional revision."),
  );
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "contentEditorFixture").requested.map((args: string[]) => args[1]),
    ),
  ).toEqual(["professional", "professional"]);
  await dialog.getByRole("button", { name: "Discard", exact: true }).click();
  expect(await value(page)).toBe(raw);
});

test("refinement submenu keeps model setup available when no local model is configured", async ({
  page,
}) => {
  await fixture(page, "Selected passage.", { model: false });
  await select(page, 0, "Selected passage.".length);
  await overflowTool(page, "Refine selection");
  await expect(page.getByRole("menuitem", { name: "Proofread", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Set up a local text model", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").requested)).toEqual(
    [],
  );
});

test("editing while refinement runs keeps the new document and blocks the completed replacement", async ({
  page,
}) => {
  await fixture(page, "Selected passage. Other text.");
  await page.evaluate(() => {
    Reflect.get(window, "contentEditorFixture").pending = true;
  });
  await select(page, 0, "Selected passage.".length);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Fixture document", exact: true })
    .fill("Newer document.");
  await page.evaluate(() =>
    Reflect.get(window, "contentEditorFixture").finish("Old selection revised."),
  );
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("changed after the selection");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  expect(await value(page)).toBe("Newer document.");
});

test("source refinement starts from the submenu and applies the completed review in one undo", async ({
  page,
}) => {
  const raw = "Original source paragraph.";
  await fixture(page, raw);
  await page.getByRole("button", { name: "Markdown source", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Fixture document", exact: true });
  await editor.focus();
  await page.keyboard.press("Control+a");
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Proofread", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await value(page)).toBe(raw);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(await value(page)).toBe("Refined text");
  await editor.focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
});

test("outdated refinement cannot replace newer text and read-only search never writes", async ({
  page,
}) => {
  await fixture(page, "A long selected passage. End.");
  await select(page, 2, 22);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await page.evaluate(() => Reflect.get(window, "contentEditorFixture").external("Newer text."));
  await expect(page.getByRole("alert")).toContainText("changed after the selection");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  expect(await value(page)).toBe("Newer text.");
});

test("read-only find ignores unrelated fields, highlights text, and has no replacements", async ({
  page,
}) => {
  await fixture(page, "Find **this**. Find this.", { readOnly: true });
  await page.getByRole("textbox", { name: "Unrelated field" }).focus();
  await page.keyboard.press("Control+f");
  await expect(page.getByRole("search")).toHaveCount(0);
  await page.getByRole("button", { name: "Find in document", exact: true }).click();
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("this");
  await expect(page.getByRole("search").getByRole("status")).toHaveText("1 of 2");
  await expect(page.getByRole("textbox", { name: "Replace with", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").writes)).toEqual([]);
});

test("multiline refinement retains outer text, boundary whitespace and one-step undo", async ({
  page,
}) => {
  const raw = "Before.\n\nFirst selected paragraph.\n\nSecond selected paragraph.\n\nAfter.";
  await fixture(page, raw);
  await page.evaluate(() => {
    Reflect.get(window, "contentEditorFixture").result =
      "Improved first paragraph.\n\nImproved second paragraph.";
  });
  await select(page, 7, 58);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(await value(page)).toContain("Before.");
  expect(await value(page)).toContain("After.");
  expect(await value(page)).toContain("Improved first paragraph.\n\nImproved second paragraph.");
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
});

test("a long selection inside one paragraph can be refined into multiple paragraphs", async ({
  page,
}) => {
  const selection = "This selected sentence contains the details to refine. ".repeat(45).trim();
  const raw = `**Before.** ${selection} **After.**`;
  await fixture(page, raw);
  const output = "A clearer first paragraph.\n\nA clearer second paragraph.";
  await page.evaluate((output) => {
    Reflect.get(window, "contentEditorFixture").result = output;
  }, output);
  await select(page, "Before. ".length, "Before. ".length + selection.length);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("A clearer second paragraph.");
  expect(await value(page)).toBe(raw);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await value(page)).toBe(`**Before.** ${output} **After.**`);
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
});

test("a complete paragraph can be refined into several paragraphs without empty outer blocks", async ({
  page,
}) => {
  const selected = "Long source paragraph. ".repeat(60).trim();
  const raw = `Before.\n\n${selected}\n\nAfter.`;
  await fixture(page, raw);
  const output = "First rewritten paragraph.\n\nSecond rewritten paragraph.";
  await page.evaluate((output) => {
    Reflect.get(window, "contentEditorFixture").result = output;
  }, output);
  await select(page, "Before.".length, "Before.".length + selected.length);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await value(page)).toBe(`Before.\n\n${output}\n\nAfter.`);
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
});

test("block refinement inside a paragraph preserves returned headings and lists", async ({
  page,
}) => {
  const raw = "**Before.** Selected passage. **After.**";
  await fixture(page, raw);
  const output = "## Revised section\n\n- First point\n- Second point";
  await page.evaluate((output) => {
    Reflect.get(window, "contentEditorFixture").result = output;
  }, output);
  await select(page, "Before. ".length, "Before. Selected passage.".length);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: "Fixture document", exact: true });
  await expect(editor.getByRole("heading", { name: "Revised section", level: 2 })).toBeVisible();
  await expect(editor.getByRole("listitem")).toHaveText(["First point", "Second point"]);
  await expect(editor.locator("strong")).toHaveText(["Before.", "After."]);
  expect(await value(page)).toContain(output);
  await editor.focus();
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(raw);
});

test("table selections remain protected from section refinement", async ({ page }) => {
  const raw = "| Column |\n| --- |\n| Selected passage. |";
  await fixture(page, raw);
  await select(page, "Column".length, "ColumnSelected passage.".length);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Tables, code");
  expect(await value(page)).toBe(raw);
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").writes)).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, "contentEditorFixture").requested)).toEqual(
    [],
  );
});

test("context keyboard opens the captured selection and cancellation leaves the document intact", async ({
  page,
}) => {
  const raw = "Keep this selected text. End.";
  await fixture(page, raw);
  await page.evaluate(() => {
    Reflect.get(window, "contentEditorFixture").pending = true;
  });
  await select(page, 5, 23);
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Refine selection", exact: true }).click();
  await page.getByRole("menuitem", { name: "Concise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel generation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("cancelled");
  expect(await value(page)).toBe(raw);
});

test("table row and column edits retain a GFM header and no merged cells", async ({ page }) => {
  await fixture(page, "Before.");
  await page.getByRole("textbox", { name: "Fixture document", exact: true }).click();
  await page.keyboard.press("Control+End");
  await overflowTool(page, "Insert table");
  const table = page
    .getByRole("textbox", { name: "Fixture document", exact: true })
    .locator("table");
  await expect(table.locator("tr")).toHaveCount(3);
  await table.locator("th").first().click();
  await page.getByRole("button", { name: "Row before", exact: true }).click();
  await expect(table.locator("tr")).toHaveCount(4);
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);
  await expect(table.locator("tr").nth(1).locator("td")).toHaveCount(3);
  await page.getByRole("button", { name: "Column after", exact: true }).click();
  await expect(table.locator("tr").first().locator("th")).toHaveCount(4);
  await page.getByRole("button", { name: "Align column right", exact: true }).click();
  expect(await value(page)).toContain("---:");
  await page.getByRole("button", { name: "Delete table", exact: true }).click();
  await expect(table).toHaveCount(0);
});

test("sticky compact toolbar has readable heading labels, accessible overflow and shadcn checkbox", async ({
  page,
}) => {
  await fixture(page, "Long paragraph with text.\n\n".repeat(150));
  const toolbar = page.locator('[data-slot="content-editor-toolbar"]');
  await expect(toolbar.getByRole("combobox", { name: "Formatting", exact: true })).toContainText(
    "Paragraph",
  );
  const sizes = await toolbar
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
    );
  expect(new Set(sizes)).toEqual(new Set([32]));
  await page.getByRole("button", { name: "More editing actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Apply dictionary", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(async () => (await toolbar.boundingBox())?.y).toBe(0);
  await toolbar.getByRole("button", { name: "Find in document", exact: true }).click();
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("text");
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("word");
  const checkbox = page.getByRole("checkbox", {
    name: "Remember replacement in dictionary",
    exact: true,
  });
  await expect(checkbox).toHaveAttribute("data-slot", "checkbox");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
});

test("German editor mode controls wrap within 480px at 200 percent text size", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await fixture(page, "Kurzer Text.");
  await page.evaluate(async () => {
    document.documentElement.style.fontSize = "200%";
    const path = "/src/i18n/index.ts";
    await (await import(path)).default.changeLanguage("de");
  });
  const toolbar = page.locator('[data-slot="content-editor-toolbar"]');
  const source = toolbar.getByRole("button", { name: "Markdown-Quelltext", exact: true });
  await expect(source).toBeVisible();
  const bounds = await toolbar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return [...element.querySelectorAll("button")].map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left - rect.left, right: box.right - rect.right };
    });
  });
  expect(bounds.every((box) => box.left >= 0 && box.right <= 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("native context menu remains for empty selection and typed one-time correction stays available", async ({
  page,
}) => {
  await fixture(page, "Original text.");
  const editor = page.getByRole("textbox", { name: "Fixture document", exact: true });
  await editor.fill("Jon called today.");
  await expect(editor).toHaveAccessibleDescription("Fixture accessible description");
  await editor.press("Home");
  await editor.press("Control+Shift+ArrowRight");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Correct and remember", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Correct and remember", exact: true });
  await dialog.getByRole("textbox", { name: "Correct spelling", exact: true }).fill("John");
  await dialog
    .getByRole("checkbox", { name: "Remember for future dictations", exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "Apply correction", exact: true }).click();
  expect(await value(page)).toBe("John called today.");
  await editor.press("ArrowRight");
  const prevented = await editor.evaluate((element) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a model result with no document text leaves the selected section unchanged", async ({
  page,
}) => {
  const raw = "Before.\n\nSelected first paragraph.\n\nSelected second paragraph.\n\nAfter.";
  await fixture(page, raw);
  await page.evaluate(() => {
    Reflect.get(window, "contentEditorFixture").result = "---";
  });
  await select(page, 7, 58);
  await overflowTool(page, "Refine selection");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unsupported Markdown result");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  expect(await value(page)).toBe(raw);
});

test("keyboard overflow refinement uses the latest selection after an earlier context menu", async ({
  page,
}) => {
  const raw = "First selected A. Second selected B.";
  await fixture(page, raw);
  await select(page, 0, 16);
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Refine selection", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await select(page, 18, 35);
  const more = page.getByRole("button", { name: "More editing actions", exact: true });
  await more.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Refine selection", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("menuitem", { name: "Rewrite", exact: true }).press("Enter");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "contentEditorFixture").requested[0]?.[2]))
    .toBe("Second selected B");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(await value(page)).toBe("First selected A. Refined text.");
});

for (const [editMode, redoMode] of [
  ["visual", "visual"],
  ["source", "source"],
  ["visual", "source"],
  ["source", "visual"],
] as const) {
  test(`Ctrl+Y redoes the logical ${editMode} edit in ${redoMode} mode`, async ({ page }) => {
    await fixture(page, "Original.");
    if (editMode === "source")
      await page.getByRole("button", { name: "Markdown source", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Fixture document", exact: true });
    await editor.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText("Changed.");
    await expect.poll(() => value(page)).toBe("Changed.");
    await page.keyboard.press("Control+z");
    await expect.poll(() => value(page)).toBe("Original.");
    if (editMode !== redoMode)
      await page
        .getByRole("button", {
          name: redoMode === "source" ? "Markdown source" : "Visual",
          exact: true,
        })
        .click();
    await editor.focus();
    await page.keyboard.press("Control+y");
    await expect.poll(() => value(page)).toBe("Changed.");
    await page.keyboard.press("Control+z");
    await expect.poll(() => value(page)).toBe("Original.");
  });
}
