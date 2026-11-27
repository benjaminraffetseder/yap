import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const event = process.env.GITHUB_EVENT_NAME;
const base = process.env.CI_BASE_SHA;
const head = process.env.CI_HEAD_SHA;
let paths = null;

if (
  event === "pull_request" ||
  (event === "push" && base && !/^0+$/.test(base))
) {
  if (!base || !head)
    throw new Error("Change detection requires base and head commits");
  const range =
    event === "pull_request" ? `${base}...${head}` : `${base}..${head}`;
  paths = execFileSync(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", range],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
} else if (event !== "push" && event !== "workflow_dispatch") {
  throw new Error(`Unsupported CI event: ${event}`);
}

const codePaths = paths?.filter(
  (path) =>
    !path.startsWith("docs/") &&
    !/\.(md|markdown)$/i.test(path) &&
    path !== "LICENSE",
);
const nativePrefixes = [
  "internal/",
  "third_party/",
  "build/",
  "scripts/",
  ".github/workflows/",
  ".github/scripts/",
];
const nativeFiles = new Set([
  "go.mod",
  "go.sum",
  "Taskfile.yml",
  "frontend/package.json",
  "frontend/package-lock.json",
  "frontend/vite.config.ts",
]);
const macos =
  !codePaths ||
  codePaths.some(
    (path) =>
      nativePrefixes.some((prefix) => path.startsWith(prefix)) ||
      nativeFiles.has(path) ||
      /\.(go|c|cc|cpp|h|m|mm)$/.test(path) ||
      /^frontend\/tsconfig[^/]*\.json$/.test(path),
  );
const include = [
  { name: "Windows x64", runner: "windows-2022", arch: "amd64", cgo: "0" },
  { name: "Linux x64", runner: "ubuntu-24.04", arch: "amd64", cgo: "1" },
];
if (macos) {
  include.push(
    {
      name: "macOS Apple Silicon",
      runner: "macos-15",
      arch: "arm64",
      cgo: "1",
    },
    { name: "macOS Intel", runner: "macos-15-intel", arch: "amd64", cgo: "1" },
  );
}
const code = !codePaths || codePaths.length > 0;
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `code=${code}\nnative_matrix=${JSON.stringify({ include })}\n`,
);
console.log(`Code checks: ${code}; macOS checks: ${macos}`);
