/**
 * The export table in `docs/api-audit-1.0.md`, regenerated from the build.
 *
 * The audit that first wrote that table (#62) read the eighteen `dist/*.d.ts`
 * trees by hand at 0.8.0. From 1.0 the table is the API contract rather than a
 * one-off reading, so it is generated instead: `package.json#exports` names the
 * entry points, the TypeScript checker names what each one exports, and the
 * declaration each name resolves to says which source file it came from.
 *
 * Usage: `npm run build` first, then `node scripts/api-table.mjs`, which
 * rewrites everything under the "## Every export" heading and leaves the prose
 * above it alone.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const doc = root + "docs/api-audit-1.0.md";
const HEADING = "## Every export";

const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
/** The subpaths that resolve to code, in the order `package.json` lists them. */
const entries = Object.entries(pkg.exports)
  .filter(([, value]) => typeof value === "object" && value !== null)
  .map(([name, value]) => [name, root + value.types.replace(/^\.\//, "")]);

const program = ts.createProgram(
  entries.map(([, file]) => file),
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true },
);
const checker = program.getTypeChecker();

/**
 * What kind of thing a name is, in the words the table uses. A declaration
 * that is an alias has already been followed, so this sees the real one.
 */
function kindOf(declaration) {
  if (ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
    return "type";
  }
  if (ts.isClassDeclaration(declaration)) return "class";
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodSignature(declaration)) {
    return "function";
  }
  if (ts.isVariableDeclaration(declaration)) {
    // A `const` whose type is a signature is a function to a reader, whatever
    // `tsc` emitted it as: `htmlToImage` and the sink factories are consts.
    const type = checker.getTypeOfSymbolAtLocation(
      checker.getSymbolAtLocation(declaration.name),
      declaration,
    );
    return type.getCallSignatures().length > 0 ? "function" : "const";
  }
  return "const";
}

/** The `src/` file a declaration came from, read off its `.d.ts` path. */
function sourceOf(declaration) {
  const file = declaration.getSourceFile().fileName.replaceAll("\\", "/");
  const inDist = file.slice(file.lastIndexOf("/dist/") + "/dist/".length);
  return "src/" + inDist.replace(/\.d\.ts$/, ".ts");
}

const sections = [];
for (const [name, file] of entries) {
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`no build output for ${name} — run npm run build first`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`${file} exports nothing`);

  const rows = [];
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaration = resolved.declarations?.[0];
    if (!declaration) continue;
    rows.push([symbol.getName(), kindOf(declaration), sourceOf(declaration)]);
  }
  // Case-insensitively, so `MAX_SLACK_TEXT` sits beside `MarkdownOptions`
  // rather than in a block of its own above every lower-case name.
  rows.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));

  const title = name === "." ? "bugbottle" : "bugbottle" + name.slice(1);
  sections.push(
    `### \`${title}\`\n\n` +
      `${rows.length} exports.\n\n` +
      "| Name | Kind | Source |\n|---|---|---|\n" +
      rows.map(([n, k, s]) => `| \`${n}\` | ${k} | \`${s}\` |`).join("\n") +
      "\n",
  );
}

const total = sections.length;
const text = readFileSync(doc, "utf8");
const at = text.indexOf(HEADING);
if (at === -1) throw new Error(`${doc} has no "${HEADING}" heading`);

const preamble =
  `${HEADING}\n\n` +
  `The whole public surface, generated from the build by\n` +
  "`node scripts/api-table.mjs` and regenerated whenever an export changes.\n" +
  `${total} entry points; a name under more than one of them is the same symbol\n` +
  "re-exported, not a copy. From 1.0 this table is the contract: removing a row\n" +
  "needs a major version, and adding an entry point needs a minor one.\n\n";

writeFileSync(doc, text.slice(0, at) + preamble + sections.join("\n") + "\n", "utf8");
console.log(`${doc}: ${total} entry points, ${sections.length} tables`);
