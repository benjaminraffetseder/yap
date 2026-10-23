import { expect, test } from "@playwright/test";
import type { TextProcessing } from "../src/lib/backend";
import { validateTextProcessing, validateVocabulary } from "../src/lib/draft-validation";

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
