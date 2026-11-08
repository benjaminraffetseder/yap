import { expect, test } from "@playwright/test";
import type { Session } from "../src/lib/backend";
import { historySearchPreview, searchRanges } from "../src/lib/history-search";
import { textSelection } from "../src/lib/text-selection";

const session = (rawTranscript: string, finalTranscript = rawTranscript, title = ""): Session => ({
  id: "one",
  createdAt: "2026-11-08T12:00:00Z",
  durationMs: 1000,
  rawTranscript,
  finalTranscript,
  title,
  speechModel: "tiny",
  language: "en",
  audioPath: "",
});

test("search snippets reveal distant matches and distinguish original-only matches", () => {
  const prefix = "Unrelated opening sentence. ".repeat(40);
  const text = prefix + "We should contact John tomorrow. " + "More notes. ".repeat(30);
  const preview = historySearchPreview(session(text), "john");
  expect(preview.text).toContain("contact John tomorrow");
  expect(preview.text.startsWith("…")).toBe(true);
  expect(preview.text.length).toBeLessThan(240);
  expect(preview.original).toBe(false);
  expect(historySearchPreview(session("Call Jon tomorrow.", "Call John tomorrow."), "Jon")).toEqual(
    { text: "Call Jon tomorrow.", original: true },
  );
  expect(historySearchPreview(session("A note.", "Edited note.", "John"), "John")).toEqual({
    text: "Edited note.",
    original: false,
  });
  expect(historySearchPreview(session(text), "").text).toBe(text);
});

test("search highlighting treats queries literally and preserves Unicode offsets", () => {
  for (const [text, query, expected] of [
    ["Plan [a+b] today", "[a+b]", "[a+b]"],
    ["İstanbul: John", "john", "John"],
    ["ΟΣ: hello", "οσ", "ΟΣ"],
    ["👋 GRÜSSE", "grüsse", "GRÜSSE"],
    ["𐐀 report", "𐐨", "𐐀"],
  ]) {
    const ranges = searchRanges(text, query);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe(expected);
  }
  expect(searchRanges("John and JOHN", "john")).toHaveLength(2);
  expect(searchRanges("Text", "")).toEqual([]);
});

test("corrections retain the selected occurrence and surrounding whitespace", () => {
  const text = "Jon called Jon yesterday.";
  const selected = textSelection(text, 10, 14)!;
  expect(selected.text).toBe("Jon");
  expect(text.slice(0, selected.start) + "John" + text.slice(selected.end)).toBe(
    "Jon called John yesterday.",
  );
  expect(textSelection("A\nB", 0, 3)).toBeNull();
  expect(textSelection("x".repeat(81), 0, 81)).toBeNull();
  expect(textSelection(" ", 0, 1)).toBeNull();
});
