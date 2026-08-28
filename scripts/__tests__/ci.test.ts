import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chdir, cwd } from 'node:process';
import { annotate, appendSummary, setOutput } from '../ci/actions.js';
import type { Gates } from '../ci/report.js';
import { renderReport } from '../ci/report.js';
import { seed } from '../ci/seed.js';
import { flag } from '../cli.js';
import type { ScrapeReport } from '../scrape.js';
import { writeIfDifferent } from '../scrape.js';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'apex-log-parser-ci-'));

const quiet: ScrapeReport = {
  docVersion: '262.0',
  apiVersion: '67.0',
  releaseKey: 'summer-26',
  s2Release: '262.0.0',
  s1Count: 185,
  s2Count: 179,
  versionBefore: '3.0.2',
  versionAfter: '3.0.2',
  dataChanged: false,
  added: [],
  changed: [],
  notInS1: [],
  restated: [],
  disagreements: [],
};

const pass: Gates = { validate: 'success', verify: 'success' };

describe('writeIfDifferent', () => {
  it('writes a new file and reports the change', () => {
    const path = join(scratch(), 'out.txt');
    expect(writeIfDifferent(path, 'one')).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('one');
  });

  it('reports no change when the bytes already match', () => {
    const path = join(scratch(), 'out.txt');
    writeIfDifferent(path, 'one');
    expect(writeIfDifferent(path, 'one')).toBe(false);
  });

  it('reports a change when the bytes differ', () => {
    const path = join(scratch(), 'out.txt');
    writeIfDifferent(path, 'one');
    expect(writeIfDifferent(path, 'two')).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('two');
  });
});

describe('flag', () => {
  it('reads --name=value, and a value may contain =', () => {
    expect(flag(['--report=run.json'], '--report')).toBe('run.json');
    expect(flag(['--out=a=b.md'], '--out')).toBe('a=b.md');
  });

  it('reports an absent flag as null', () => {
    expect(flag(['--other=1'], '--report')).toBeNull();
  });

  it('refuses the space-separated form by name', () => {
    // Silently absent would let a scrape finish having written no run record
    expect(() => flag(['--report', 'run.json'], '--report')).toThrow(/needs a value/);
  });
});

describe('actions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const stub = (variable: string): string => {
    const path = join(scratch(), 'file');
    writeFileSync(path, '');
    vi.stubEnv(variable, path);
    return path;
  };

  it('writes a step output in the heredoc form, so a newline cannot corrupt it', () => {
    const path = stub('GITHUB_OUTPUT');
    expect(setOutput('changed', 'true')).toBe(true);
    expect(setOutput('body', 'two\nlines')).toBe(true);

    const written = readFileSync(path, 'utf-8');
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    expect(written).toMatch(new RegExp(`^changed<<EOF_(${uuid})\\ntrue\\nEOF_\\1\\n`));
    expect(written).toContain('two\nlines');
  });

  it('is a no-op off a runner rather than a failure', () => {
    vi.stubEnv('GITHUB_OUTPUT', undefined);
    expect(setOutput('changed', 'true')).toBe(false);
    vi.stubEnv('GITHUB_STEP_SUMMARY', undefined);
    expect(appendSummary('# hello')).toBe(false);
  });

  it('appends a summary, ending it with a newline', () => {
    const path = stub('GITHUB_STEP_SUMMARY');
    expect(appendSummary('# hello')).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('# hello\n');
  });

  it('refuses a summary over the 1 MiB GitHub renders, rather than being truncated', () => {
    const path = stub('GITHUB_STEP_SUMMARY');
    expect(() => appendSummary('x'.repeat(1024 * 1024 + 1))).toThrow(/over the/);
    expect(readFileSync(path, 'utf-8')).toBe('');
  });

  it('folds a newline out of an annotation, which would otherwise end the command', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: string) => lines.push(m));
    annotate('error', 'first\nsecond');
    spy.mockRestore();
    expect(lines).toEqual(['::error::first second']);
  });
});

describe('renderReport', () => {
  const busy: ScrapeReport = {
    ...quiet,
    dataChanged: true,
    versionAfter: '3.0.3',
    added: ['ZZZ_NEW'],
    changed: ['SOQL_EXECUTE_BEGIN'],
    notInS1: ['OLD_EVENT'],
    restated: [
      {
        event: 'VF_APEX_CALL_END',
        source: 'S1',
        field: 'category',
        stored: 'VISUALFORCE',
        scraped: 'APEX_CODE',
      },
    ],
    disagreements: [
      { event: 'ONLY_DOCS', reason: 'only-in-s1' },
      { event: 'ONLY_HELP', reason: 'only-in-s2' },
      { event: 'MOVED', reason: 'level', s1: 'INFO', s2: 'FINE' },
    ],
  };

  it('says up front when nothing needs a decision', () => {
    const body = renderReport(quiet, pass);
    expect(body).toContain('**Nothing here needs a decision**');
    expect(body).not.toContain('## Needs a decision');
    expect(body.endsWith('\n')).toBe(true);
  });

  it('states what was read and what changed', () => {
    const body = renderReport(quiet, pass);
    expect(body).toContain('| Developer docs | doc 262.0, API 67.0 | 185 |');
    expect(body).toContain('| Help article | 262.0.0 | 179 |');
    expect(body).toContain('| Database version | 3.0.2 (unchanged) |');
    expect(body).toContain('| New events | none |');
    expect(body).toContain('Checks — tests: `success` · schema: `success`');
  });

  it('puts a failing gate under the decisions, with what to do', () => {
    const body = renderReport(quiet, { validate: 'success', verify: 'failure' });
    expect(body).toContain('## Needs a decision');
    expect(body).toContain('needs a class in `src/`');
    expect(body).toContain('Checks — tests: `failure`');
    expect(body).not.toContain('does not match its schema');
    expect(body).not.toContain('Nothing here needs a decision');
  });

  it('puts a failing schema check under the decisions', () => {
    const body = renderReport(quiet, { validate: 'failure', verify: 'success' });
    expect(body).toContain('does not match its schema');
  });

  it('asks for a decision on an absence and on a contradicted value', () => {
    const body = renderReport(busy, pass);
    expect(body).toContain('`OLD_EVENT` is recorded against the developer docs');
    expect(body).toContain('set `release_deprecated`');
    expect(body).toContain(
      '`VF_APEX_CALL_END` category: recorded as VISUALFORCE here, but now APEX_CODE in ' +
        'the developer docs',
    );
    expect(body).toContain('decide which is right');
  });

  it('reports a new event with the release it is tagged for', () => {
    const body = renderReport(busy, pass);
    expect(body).toContain('| New events | 1, tagged for release `summer-26` — `ZZZ_NEW` |');
    expect(body).toContain('| Database version | 3.0.2 → 3.0.3 |');
    expect(body).toContain('| Events with a changed category or level | 1 |');
  });

  it('folds the source differences away, grouped and explained', () => {
    const body = renderReport(busy, pass);
    expect(body).toContain('<summary>The two sources differ on 3 events</summary>');
    expect(body).toContain('catches');
    expect(body).toContain('expected and needs no action');
    expect(body).toContain('**Only in the developer docs (1)**');
    expect(body).toContain('- `ONLY_DOCS`');
    expect(body).toContain('**Only in the Help article (1)**');
    expect(body).toContain('- `ONLY_HELP`');
    expect(body).toContain('**Different category or level (1)**');
    expect(body).toContain('- `MOVED` level: developer docs INFO, Help article FINE');
    expect(body).toContain('</details>');
  });

  it('states agreement plainly when there is nothing to fold away', () => {
    const body = renderReport({ ...quiet, disagreements: [] }, pass);
    expect(body).toContain('Both sources list the same events.');
    expect(body).not.toContain('<details>');
  });

  it('says the help article was not read, rather than claiming agreement', () => {
    const body = renderReport({ ...quiet, s2Release: null, s2Count: null }, pass);
    expect(body).toContain('| Help article | not read on this run | — |');
    expect(body).toContain('could not be read, so the two sources were not compared');
    expect(body).not.toContain('list the same events');
  });

  it('uses only ## headings, never a bold line standing in for one', () => {
    for (const body of [renderReport(quiet, pass), renderReport(busy, pass)]) {
      const headingish = body
        .split('\n')
        .filter((l) => l.startsWith('**') && l.endsWith('**') && !l.includes('('));
      expect(headingish).toEqual([]);
    }
  });

  it('leaves no run of blank lines', () => {
    expect(renderReport(quiet, pass)).not.toMatch(/\n\n\n/);
    expect(renderReport(busy, pass)).not.toMatch(/\n\n\n/);
    expect(renderReport(busy, { validate: 'failure', verify: 'failure' })).not.toMatch(/\n\n\n/);
  });
});

describe('seed', () => {
  const git = (dir: string, ...args: string[]): void => {
    const { status, stderr } = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
    if (status !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  };

  const withCwd = (dir: string, run: () => void): void => {
    const before = cwd();
    chdir(dir);
    try {
      run();
    } finally {
      chdir(before);
    }
  };

  /** An origin holding a branch whose data/ differs from the one a clone starts on. */
  let origin: string;

  // Built once: the git plumbing dominates this suite's runtime, and each test
  // gets its own clone, so nothing is shared that a test could mutate
  beforeAll(() => {
    origin = join(scratch(), 'origin');
    mkdirSync(join(origin, 'data'), { recursive: true });
    git(origin, 'init', '--initial-branch=main', '.');
    git(origin, 'config', 'user.email', 'test@example.com');
    git(origin, 'config', 'user.name', 'Test');
    // Independent of whatever signing the developer's global config requires
    git(origin, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(origin, 'data', 'events.json'), 'base\n');
    git(origin, 'add', '.');
    git(origin, 'commit', '-m', 'base');

    git(origin, 'checkout', '-b', 'auto/scrape');
    writeFileSync(join(origin, 'data', 'events.json'), 'curated\n');
    git(origin, 'commit', '-am', 'curated');
    git(origin, 'checkout', 'main');
  });

  const clone = (): string => {
    const root = scratch();
    const path = join(root, 'clone');
    git(root, 'clone', origin, path);
    return path;
  };

  it('checks out data/ from the branch when it exists', () => {
    const working = clone();
    withCwd(working, () => {
      expect(seed('auto/scrape')).toBe(true);
      expect(readFileSync(join(working, 'data', 'events.json'), 'utf-8')).toBe('curated\n');
    });
  });

  it('leaves data/ alone when the branch does not exist', () => {
    const working = clone();
    withCwd(working, () => {
      expect(seed('auto/absent')).toBe(false);
      expect(readFileSync(join(working, 'data', 'events.json'), 'utf-8')).toBe('base\n');
    });
  });

  it('throws when git itself fails, rather than reading it as an absent branch', () => {
    // Reading a failure as "absent" would rebuild data/ from the base branch and
    // force-push away the curation this step exists to keep
    withCwd(scratch(), () => {
      expect(() => seed('auto/scrape')).toThrow(/git exited 128/);
    });
  });
});
