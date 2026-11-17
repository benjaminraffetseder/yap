import { expect, test } from "@playwright/test";
import { textProcessingSchema } from "../src/features/prompts/lib/prompt-schemas";
import { correctionSchema } from "../src/features/transcripts/lib/correction-schema";
import { vocabularySchema } from "../src/features/vocabulary/lib/vocabulary-schemas";
import i18n from "../src/i18n";
import type { TextProcessing } from "../src/lib/backend";
import { validateTextProcessing, validateVocabulary } from "../src/lib/validation/draft-validation";

const config = (): TextProcessing => ({
  enabled: false,
  endpoint: "http://localhost:11434/v1",
  model: "",
  autoPromptId: "",
  prompts: [{ id: "prompt", name: "Prompt", instruction: "Instructions" }],
  chains: [],
});

test("draft validation mirrors local endpoints, prompt limits and chain references", () => {
  for (const endpoint of [
    "http://localhost:11434/v1",
    "https://127.0.0.2/v1/",
    "http://[::1]:1234/v1",
    "http://127.0.0.1:00080/v1",
  ]) {
    expect(validateTextProcessing({ ...config(), endpoint })).toBe("");
  }
  for (const endpoint of [
    "http://remote.example/v1",
    "http://127.1/v1",
    "http://127.0.0.1/v1?",
    "http://localhost/v1?q=1",
    "http://user@localhost/v1",
    "http://localhost/other/../v1",
    "http://localhost/%76%31",
    "http://localhost:0/v1",
    "http://localhost:70000/v1",
    "http://localhost/api/v1",
  ]) {
    expect(validateTextProcessing({ ...config(), endpoint })).not.toBe("");
  }
  const value = config();
  value.prompts[0].instruction = "";
  expect(validateTextProcessing(value)).toContain("needs instructions");
  value.prompts[0].instruction = "x".repeat(8001);
  expect(validateTextProcessing(value)).toContain("needs instructions");
  value.prompts[0].instruction = "\nValid instruction\n";
  value.prompts[0].name = "\nValid name\n";
  expect(validateTextProcessing(value)).toBe("");
  value.chains = [
    { id: "chain", name: "Chain", steps: [{ id: "step", promptId: "missing", input: "original" }] },
  ];
  expect(validateTextProcessing(value)).toContain("existing prompt");
  value.chains[0].steps[0].promptId = "prompt";
  value.chains[0].steps[0].input = "step:step";
  expect(validateTextProcessing(value)).toContain("earlier step");
  value.chains[0].steps[0].input = "original";
  expect(validateTextProcessing(value)).toBe("");
  value.autoPromptId = "chain";
  expect(validateTextProcessing(value)).toContain("Enable a model");
});

test("vocabulary validation attributes duplicate aliases and invalid spellings to rows", () => {
  expect(
    validateVocabulary([{ id: "a", canonical: "", aliases: ["alias"], enabled: true }]).a,
  ).toContain("1–80");
  const errors = validateVocabulary([
    { id: "a", canonical: "Term", aliases: ["Postgres"], enabled: true },
    { id: "b", canonical: "postgres", aliases: [], enabled: false },
  ]);
  expect(errors.a).toContain("already assigned");
  expect(errors.b).toContain("already assigned");
  expect(
    validateVocabulary([{ id: "a", canonical: "\nTerm\n", aliases: [], enabled: true }]),
  ).toEqual({});
});

test("schemas report nested field paths and reject malformed input without throwing", () => {
  const value = config();
  value.prompts[0].instruction = "";
  value.chains = [
    {
      id: "chain",
      name: "Chain",
      steps: [{ id: "step", promptId: "missing", input: "step:step" }],
    },
  ];
  const result = textProcessingSchema.safeParse(value);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ["prompts", 0, "instruction"],
      ["chains", 0, "steps", 0, "promptId"],
      ["chains", 0, "steps", 0, "input"],
    ]);
    expect(validateTextProcessing(value)).toBe(result.error.issues[0].message);
  }
  expect(textProcessingSchema.safeParse({ ...config(), prompts: null }).success).toBe(false);
  expect(
    vocabularySchema.safeParse([{ id: "a", canonical: "Term", aliases: "alias" }]).success,
  ).toBe(false);
});

test("validation preserves raw drafts and distinguishes byte IDs from character limits", () => {
  const value = config();
  value.prompts[0] = {
    id: "🙂".repeat(20),
    name: `\n${"🙂".repeat(80)}\n`,
    instruction: "  Keep spaces\n",
  };
  expect(textProcessingSchema.parse(value)).toEqual(value);
  value.prompts[0].id += "a";
  expect(validateTextProcessing(value)).toContain("identifiers");
  value.prompts[0].id = "prompt";
  value.prompts[0].name += "a";
  expect(validateTextProcessing(value)).toContain("name");
  value.prompts[0].name = "Valid";
  value.prompts[0].instruction = "Invalid\uD800";
  expect(validateTextProcessing(value)).toContain("instructions");
  const entries = [
    { id: "🙂".repeat(16), canonical: ` ${"🙂".repeat(80)} `, aliases: [], enabled: true },
  ];
  expect(vocabularySchema.parse(entries)).toEqual(entries);
  entries[0].id += "a";
  expect(validateVocabulary(entries)[entries[0].id]).toContain("IDs");
});

test("duplicate spelling issues point to both fields and preserve Unicode simple folding", () => {
  for (const [alias, canonical] of [
    ["µ", "Μ"],
    ["ſ", "s"],
    ["ς", "Σ"],
    ["a.b", "A.B"],
  ]) {
    const entries = [
      { id: "a", canonical: "Unique", aliases: [alias], enabled: true },
      { id: "b", canonical, aliases: [], enabled: false },
    ];
    const result = vocabularySchema.safeParse(entries);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        [1, "canonical"],
        [0, "aliases", 0],
      ]);
    }
    expect(Object.keys(validateVocabulary(entries, { conciseDuplicates: true })).sort()).toEqual([
      "a",
      "b",
    ]);
  }
  expect(
    vocabularySchema.safeParse([
      { id: "a", canonical: "a.b", aliases: [], enabled: true },
      { id: "b", canonical: "axb", aliases: [], enabled: true },
    ]).success,
  ).toBe(true);
});

test("schema messages follow the current language after schemas have been created", async () => {
  const schema = correctionSchema({ source: "Jon", start: 0, end: 3 });
  try {
    await i18n.changeLanguage("en");
    const english = schema.safeParse({ spelling: "", remember: true });
    if (english.success) throw new Error("Empty spelling must be invalid");
    const englishMessage = english.error.issues[0].message;
    await i18n.changeLanguage("de");
    const german = schema.safeParse({ spelling: "", remember: true });
    if (german.success) throw new Error("Empty spelling must be invalid");
    expect(englishMessage).not.toBe(german.error.issues[0].message);
    expect(german.error.issues[0].message).toBe(
      i18n.t("draftValidation.use180CharactersWithoutLineBreaksFor"),
    );
    const value = config();
    value.prompts[0].name = "";
    expect(validateTextProcessing(value)).toBe(i18n.t("draftValidation.giveEachPromptANameOfUp"));
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("corrections enforce phrase and resulting transcript limits without trimming the draft", () => {
  const schema = correctionSchema({ source: "x".repeat(99999) + "🙂", start: 99999, end: 100001 });
  const values = { spelling: " 🙂 ", remember: false };
  expect(schema.parse(values)).toEqual(values);
  expect(schema.safeParse({ ...values, spelling: "🙂🙂" }).success).toBe(false);
  const short = correctionSchema({ source: "Jon", start: 0, end: 3 });
  expect(short.safeParse({ ...values, spelling: "🙂".repeat(80) }).success).toBe(true);
  expect(short.safeParse({ ...values, spelling: "🙂".repeat(81) }).success).toBe(false);
});
