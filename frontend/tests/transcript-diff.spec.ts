import { expect, test } from "@playwright/test";
import { transcriptDiff } from "../src/lib/transcript-diff";

test("transcript diffs preserve both versions including Unicode, whitespace and punctuation", () => {
  const cases = [
    ["", ""],
    ["", "Hello!"],
    ["Remove me", ""],
    ["Same text", "Same text"],
    ["Send postgres tomorrow.", "Send PostgreSQL today."],
    ["café 👋\n你好 世界", "café 👋\n你好 Benji"],
    ["a b a b", "b a b a"],
    ["one\n\ntwo", "one two"],
    ["**Bold** & <script>", "**Bold** & <plain>"],
    [
      "unchanged start " + "old ".repeat(10000) + " end",
      "unchanged start " + "new ".repeat(10000) + " end",
    ],
  ];
  // Include repeated tokens and unrelated edits to exercise backtracking.
  for (let i = 0; i < 200; i++) {
    const make = (offset: number) =>
      Array.from(
        { length: i % 23 },
        (_, j) => ["a", "b", " ", "\n", "é", "!"][(j * j + offset + i) % 6],
      ).join("");
    cases.push([make(0), make(i % 6)]);
  }
  for (const [before, after] of cases) {
    const parts = transcriptDiff(before, after);
    expect(
      parts
        .filter((part) => part.kind !== "added")
        .map((part) => part.text)
        .join(""),
    ).toBe(before);
    expect(
      parts
        .filter((part) => part.kind !== "removed")
        .map((part) => part.text)
        .join(""),
    ).toBe(after);
  }
  expect(transcriptDiff("Send postgres tomorrow.", "Send PostgreSQL today.")).toEqual([
    { kind: "same", text: "Send " },
    { kind: "removed", text: "postgres" },
    { kind: "added", text: "PostgreSQL" },
    { kind: "same", text: " " },
    { kind: "removed", text: "tomorrow" },
    { kind: "added", text: "today" },
    { kind: "same", text: "." },
  ]);
});
