/**
 * Runs the micro-benchmark cases in `cases.ts` on one log, in Node and in headless Chromium, and
 * prints a Markdown table per question. Each case runs in a process or browser of its own, so no
 * case inherits another's JIT feedback.
 *
 * Usage: pnpm run bench:micro --file=<log> [--runs=7] [--chromium=<binary>]
 *
 * Without `--chromium`, it uses the newest Playwright headless shell it finds, or runs Node only.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runJsonChild } from '../child.js';
import { flag, runIfMain } from '../cli.js';
import { formatBytes, formatMs } from '../compare/report.js';
import type { Input } from './cases.js';
import { CASES, timeCase } from './cases.js';

type Result = ReturnType<typeof timeCase>;

const USAGE = 'Usage: pnpm run bench:micro --file=<log> [--runs=7] [--chromium=<binary>]';

function inputOf(file: string): Input {
  const buffer = readFileSync(file);
  let text: string | null = null;
  return {
    // A plain Uint8Array over the same memory, so its indexOf is V8's, not Node's.
    bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length),
    get text() {
      text ??= new TextDecoder().decode(buffer);
      return text;
    },
    buffer: buffer as unknown as Input['buffer'],
  };
}

/** The newest Playwright headless shell for any platform, or null. */
function findChromium(): string | null {
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  const alt = join(homedir(), '.cache/ms-playwright');
  const base = existsSync(root) ? root : existsSync(alt) ? alt : null;
  if (!base) return null;
  const dirs = readdirSync(base)
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse();
  for (const dir of dirs) {
    for (const platform of readdirSync(join(base, dir)).filter((d) =>
      d.startsWith('chrome-headless-shell'),
    )) {
      const bin = join(base, dir, platform, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

/** Writes one HTML page per case: it loads the log, runs the case and writes the result into the body. */
function chromiumPages(file: string, runs: number): (index: number) => string {
  const dir = mkdtempSync(join(tmpdir(), 'micro-'));
  const cases = stripTypeScriptTypes(
    readFileSync(fileURLToPath(new URL('./cases.ts', import.meta.url)), 'utf-8'),
  );
  return (index) => {
    const page = join(dir, `case-${index}.html`);
    writeFileSync(
      page,
      `<!doctype html><body></body><script type="module">
${cases}
// Sync XHR, so the page has finished before the load event that --dump-dom waits for. In a
// function, so the raw text is garbage before the case is timed.
function load() {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', ${JSON.stringify(pathToFileURL(file).href)}, false);
  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.send();
  const raw = xhr.responseText;
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  return bytes;
}
const bytes = load();
let text = null;
const input = { bytes, get text() { return (text ??= new TextDecoder().decode(bytes)); }, buffer: null };
document.body.textContent = 'RESULT' + JSON.stringify(timeCase(CASES[${index}], input, ${runs}, () => performance.now()));
</script>`,
    );
    return page;
  };
}

function runInChromium(binary: string, page: string): Result {
  const child = spawnSync(
    binary,
    [
      '--headless',
      '--allow-file-access-from-files',
      '--disable-gpu',
      '--dump-dom',
      pathToFileURL(page).href,
    ],
    { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 600_000 },
  );
  const found = /RESULT(.*?)</.exec(child.stdout);
  if (!found) {
    throw new Error(
      `Chromium gave no result: ${child.stderr.trim().split('\n').slice(-2).join(' ')}`,
    );
  }
  return JSON.parse(found[1] ?? 'null') as Result;
}

const cell = (r: Result | null): string => (r ? formatMs(r.ms) : 'n/a');

runIfMain(import.meta.url, () => {
  const args = argv.slice(2);
  const file = flag(args, '--file');
  if (!file) throw new Error(USAGE);
  const runs = Number(flag(args, '--runs') ?? 7);

  const only = flag(args, '--case');
  if (only !== null) {
    // case indexes come from CASES itself
    console.log(
      JSON.stringify(timeCase(CASES[Number(only)]!, inputOf(file), runs, () => performance.now())),
    );
    return;
  }

  const chromium = flag(args, '--chromium') ?? findChromium();
  const pages = chromium ? chromiumPages(file, runs) : null;
  const inBrowser = chromium && pages ? (i: number) => runInChromium(chromium, pages(i)) : null;
  const script = fileURLToPath(import.meta.url);
  const rows = CASES.map((c, i) => ({
    c,
    node: runJsonChild(script, [`--file=${file}`, `--runs=${runs}`, `--case=${i}`]) as Result,
    browser: inBrowser && !c.nodeOnly ? inBrowser(i) : null,
  }));

  const out = [
    '# Micro-benchmarks',
    '',
    `${formatBytes(statSync(file).size)} log, median of ${runs} runs after 2 warm-ups. Node ${process.version}.`,
    '',
  ];
  const mismatches = [
    ...rows.flatMap((r) =>
      r.browser && r.browser.check !== r.node.check
        ? [`${r.c.name}: Node and Chromium differ`]
        : [],
    ),
    ...[...new Set(CASES.flatMap((c) => (c.agree ? [c.agree] : [])))].flatMap((key) => {
      const checks = new Set(rows.filter((r) => r.c.agree === key).map((r) => r.node.check));
      return checks.size > 1 ? [`cases that should agree on '${key}' do not`] : [];
    }),
  ];
  for (const group of [...new Set(CASES.map((c) => c.group))]) {
    out.push(`## ${group}`, '', '| Case | Node | Chromium |', '| --- | ---: | ---: |');
    for (const r of rows.filter((x) => x.c.group === group)) {
      out.push(
        `| ${r.c.name} | ${cell(r.node)} | ${inBrowser && !r.c.nodeOnly ? cell(r.browser) : '—'} |`,
      );
    }
    out.push('');
  }
  if (mismatches.length)
    out.push('## Checksum mismatches', '', ...mismatches.map((m) => `- ${m}`), '');
  console.log(out.join('\n'));
});
