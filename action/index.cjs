#!/usr/bin/env node
/**
 * bugbottle GitHub Action — validate JSON bug reports in CI.
 *
 * Zero runtime dependencies: report validation logic is inlined from
 * bugbottle's report-core (same rules), so this action installs instantly
 * and never breaks on a transitive dependency. Kept in sync by a unit test
 * in the parent repo that compares behaviour against report-core itself.
 *
 * Memory note: @actions/core is avoided on purpose — stdout workflow commands
 * (::set-output, ::error) do the same job without the dependency.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPORT_TYPES = ['bug', 'idea', 'other'];
const MAX_MESSAGE_LENGTH = 4000;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const MAX_SCREENSHOT_DATA_URL_LENGTH = 2_900_000;

function setInput(name, fallback) {
  const key = 'INPUT_' + name.toUpperCase().replace(/-/g, '_');
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function fail(msg) {
  process.stdout.write(`::error::${msg}\n`);
}

function setOutput(name, value) {
  process.stdout.write(`::set-output name=${name}::${value}\n`);
}

/** Mirrors normaliseMessage in report-core.ts. */
function validMessage(raw) {
  return typeof raw === 'string' && raw.trim().length > 0 && raw.length <= MAX_MESSAGE_LENGTH;
}

/** Mirrors decodeScreenshotDataUrl's checks, without decoding to bytes. */
function validScreenshot(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return false;
  if (dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) return false;
  let bytes;
  try {
    bytes = Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64');
  } catch {
    return false;
  }
  if (bytes.length > MAX_SCREENSHOT_BYTES || bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/** Returns a list of problem strings; empty means the report is valid. */
function validateReport(report, { requireScreenshot }) {
  const problems = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return ['report is not a JSON object'];
  }
  if (!REPORT_TYPES.includes(report.type)) {
    problems.push(`type must be one of ${REPORT_TYPES.join(', ')}`);
  }
  if (!validMessage(report.message)) {
    problems.push('message missing or too long');
  }
  const ctx = report.context ?? {};
  if (!ctx || typeof ctx !== 'object') {
    problems.push('context missing');
  } else {
    for (const k of ['url', 'viewport', 'userAgent']) {
      if (typeof ctx[k] !== 'string') problems.push(`context.${k} must be a string`);
    }
  }
  if (report.console !== undefined) {
    if (!Array.isArray(report.console)) problems.push('console must be an array');
    else {
      for (const entry of report.console) {
        if (!entry || typeof entry !== 'object' ||
            typeof entry.ts !== 'string' || typeof entry.level !== 'string' || typeof entry.message !== 'string') {
          problems.push('console entries need ts/level/message strings');
          break;
        }
      }
    }
  }
  if (report.screenshotDataUrl !== undefined) {
    if (!validScreenshot(report.screenshotDataUrl)) {
      problems.push('screenshotDataUrl is not a valid PNG data URL within size limits');
    }
  } else if (requireScreenshot) {
    problems.push('screenshot required but absent');
  }
  return problems;
}

/** Minimal glob: supports **, * and ? — no dependency on minimatch. */
function globToRegExp(pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function main() {
  const glob = setInput('reports-glob', null);
  const requireScreenshot = String(setInput('require-screenshot', 'false')) === 'true';
  const maxKb = parseInt(setInput('max-report-size-kb', '4096'), 10);

  if (!glob) {
    fail("input 'reports-glob' is required (e.g. reports/*.json)");
    process.exit(1);
  }

  const re = globToRegExp(glob);
  const files = walk(process.cwd(), []).filter((f) => re.test(path.relative(process.cwd(), f).split(path.sep).join('/')));

  if (files.length === 0) {
    fail(`no report files matched '${glob}'`);
    process.exit(1);
  }

  let valid = 0;
  let invalid = 0;
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    let report = null;
    try {
      const sizeKb = fs.statSync(file).size / 1024;
      if (sizeKb > maxKb) throw new Error(`file larger than ${maxKb} KB`);
      report = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      invalid++;
      fail(`${rel}: unreadable or oversized (${e.message})`);
      continue;
    }
    const problems = validateReport(report, { requireScreenshot });
    if (problems.length === 0) {
      valid++;
      process.stdout.write(`ok: ${rel}\n`);
    } else {
      invalid++;
      for (const p of problems) fail(`${rel}: ${p}`);
    }
  }

  setOutput('valid-count', String(valid));
  setOutput('invalid-count', String(invalid));
  process.stdout.write(`bugbottle: ${valid} valid, ${invalid} invalid of ${files.length} report(s)\n`);
  process.exit(invalid > 0 ? 1 : 0);
}

main();
