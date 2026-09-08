/**
 * The privacy checklist is an inventory, and an inventory is only worth
 * reading when it is complete. A field added to `BugReport` and left out of
 * the table would be a field an integrator promised their users does not
 * exist, so the two lists are compared here against the generated schema —
 * the same schema the payload documentation and the Action are pinned to.
 *
 * Both languages are checked. The Danish page is the same page, and a row
 * added in one language and forgotten in the other is the ordinary way a
 * translation goes quietly wrong.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildReportSchema } from "../scripts/build-schema.ts";

const root = new URL("../", import.meta.url);

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, root)), "utf8").replace(/\r\n/g, "\n");
}

/** The fields of the payload, as the published schema describes them. */
function reportFields(): string[] {
  const schema = buildReportSchema() as {
    $defs: { BugReport: { properties: Record<string, unknown> } };
  };
  return Object.keys(schema.$defs.BugReport.properties);
}

/**
 * The first column of the one table on a page whose first heading cell is
 * `header`, as the names inside its backticks. Anything else in the cell is
 * ignored: the column holds a field name and nothing else.
 */
function checklistFields(markdown: string, header: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    return cells[1] === header;
  });
  assert.notEqual(start, -1, `no table with a "${header}" column`);
  const fields: string[] = [];
  /* The row after the header is the alignment row; the table ends at the
     first line that is not a row. */
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cell = line.split("|")[1] ?? "";
    const name = /`([^`]+)`/.exec(cell);
    assert.ok(name, `row without a field name: ${line.slice(0, 60)}`);
    fields.push(name[1] as string);
  }
  return fields;
}

/** The README section, sliced at its own heading and the next one. */
function section(markdown: string, heading: string): string {
  const from = markdown.indexOf(`\n## ${heading}\n`);
  assert.notEqual(from, -1, `README has no "## ${heading}" section`);
  const rest = markdown.slice(from + 1);
  const to = rest.indexOf("\n## ", 1);
  return to === -1 ? rest : rest.slice(0, to);
}

test("the English checklist lists every field of a report", () => {
  const fields = checklistFields(section(read("README.md"), "A privacy checklist"), "Field");
  assert.deepEqual([...fields].sort(), reportFields().sort());
});

test("the Danish checklist lists every field of a report", () => {
  const fields = checklistFields(read("site/da/privatliv.md"), "Felt");
  assert.deepEqual([...fields].sort(), reportFields().sort());
});

test("the two checklists are in the same order", () => {
  const english = checklistFields(section(read("README.md"), "A privacy checklist"), "Field");
  const danish = checklistFields(read("site/da/privatliv.md"), "Felt");
  assert.deepEqual(danish, english);
});
