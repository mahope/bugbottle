import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_REF_NAME, GITHUB_SHA, GITHUB_ENV } = process.env;
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${version}`;
if (!["push", "workflow_dispatch"].includes(GITHUB_EVENT_NAME) ||
    GITHUB_REF !== `refs/tags/${tag}` || GITHUB_REF_NAME !== tag) {
  throw new Error(`Release must run on the package.json version tag ${tag}, including manual dispatch`);
}
const resolve = (ref) => execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
// Peel annotated tags as well as lightweight tags, and verify the checkout too.
if (!GITHUB_SHA || resolve(`refs/tags/${tag}^{commit}`) !== GITHUB_SHA || resolve("HEAD") !== GITHUB_SHA) {
  throw new Error("Version tag and checkout must both resolve to the exact release SHA");
}
appendFileSync(GITHUB_ENV, `RELEASE_TAG=${tag}\n`);
