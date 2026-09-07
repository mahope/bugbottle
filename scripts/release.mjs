#!/usr/bin/env node
// Usage: npm run release -- patch|minor|major|<x.y.z>
// Bumps package.json, commits, tags vX.Y.Z and pushes; CI publishes to npm
// and creates the GitHub release.
import { execSync } from 'node:child_process';

const bump = process.argv[2];
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump ?? '')) {
  console.error('Usage: npm run release -- patch|minor|major|<x.y.z>');
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
if (execSync('git status --porcelain').toString().trim()) {
  console.error('Working tree is dirty; commit or stash first.');
  process.exit(1);
}
run(`npm version ${bump} -m "Udgiv v%s"`);
run('git push --follow-tags');
