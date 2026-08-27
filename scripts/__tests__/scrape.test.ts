import database from '../../data/salesforce-debug-log-events.json' with { type: 'json' };
import s1Content from '../__fixtures__/s1-content-262.0.json' with { type: 'json' };
import s1Metadata from '../__fixtures__/s1-metadata.json' with { type: 'json' };
import s2Article from '../__fixtures__/s2-article-262.0.0.json' with { type: 'json' };
import type { DocVersion, S1Metadata, ScrapedEvent, ScrapeRun } from '../scrape.js';
import {
  articleHtml,
  articleRecord,
  crossCheck,
  mergeEvents,
  parseEventTable,
  pickDocVersion,
  releaseCovers,
  releaseIdentity,
  resolveRelease,
  squeezeRow,
  vocabulary,
} from '../scrape.js';

const vocab = vocabulary(database);
const s2Record = s2Article.actions[0]!.returnValue.returnValue.record as Record<string, unknown>;

const s1Events = parseEventTable(s1Content.content, 'S1', vocab);
const s2Events = parseEventTable(articleHtml(s2Record, 'S2'), 'S2', vocab);

const byName = (events: ScrapedEvent[], name: string): ScrapedEvent | undefined =>
  events.find((e) => e.name === name);

describe('parseEventTable', () => {
  it('reads every documented event from the developer docs', () => {
    expect(s1Events).toHaveLength(185);
  });

  it('reads every documented event from the help site', () => {
    expect(s2Events).toHaveLength(179);
  });

  it('agrees with the developer docs on the first row of both renderings', () => {
    for (const events of [s1Events, s2Events]) {
      expect(byName(events, 'BULK_HEAP_ALLOCATE')).toEqual({
        name: 'BULK_HEAP_ALLOCATE',
        category: 'APEX_CODE',
        level: 'FINEST',
        description: 'Number of bytes allocated',
        fields: ['Number of bytes allocated'],
      });
    }
  });

  it('reads the CURSOR_ rows, whose developer-docs cells are shifted', () => {
    // These four arrive with an extra empty cell and mislabelled column
    // attributes, so an attribute-driven read assigns them the fields text.
    const cursors = [
      'CURSOR_CREATE_BEGIN',
      'CURSOR_CREATE_END',
      'CURSOR_FETCH',
      'CURSOR_FETCH_PAGE',
    ];
    for (const name of cursors) {
      for (const events of [s1Events, s2Events]) {
        expect(byName(events, name)).toMatchObject({ category: 'DB', level: 'INFO' });
      }
    }
  });

  it('normalises the help site prose level to a log token', () => {
    // The help site states "FINER and above"; the developer docs state "FINER"
    expect(byName(s2Events, 'FLOW_BULK_ELEMENT_LIMIT_USAGE')?.level).toBe('FINER');
    expect(byName(s1Events, 'FLOW_BULK_ELEMENT_LIMIT_USAGE')?.level).toBe('FINER');
  });

  it('collapses a row whose name carries a parenthetical suffix', () => {
    expect(byName(s1Events, 'CALLOUT_REQUEST')).toBeDefined();
    expect(s1Events.filter((e) => e.name === 'CALLOUT_REQUEST')).toHaveLength(1);
  });

  it('states a known category and level for every event', () => {
    const categories = new Set(database.categories.map((c) => c.name));
    for (const event of [...s1Events, ...s2Events]) {
      expect(categories).toContain(event.category);
      expect(database.log_levels).toContain(event.level);
    }
  });

  it('rejects a document whose event table is gone', () => {
    const stripped = s1Content.content.replace(/<table[\s\S]*?<\/table>/g, '');
    expect(() => parseEventTable(stripped, 'S1', vocab)).toThrow(/exactly one table/);
  });

  it('rejects a table that has gained a column', () => {
    // Otherwise the surplus cell is silently squeezed away row by row
    const widened = s1Content.content.replace(
      /(<th[^>]*>Level Logged<\/th>)/,
      '$1<th class="entry">Since</th>',
    );
    expect(widened).not.toBe(s1Content.content);
    expect(() => parseEventTable(widened, 'S1', vocab)).toThrow(/exactly one table/);
  });

  it('rejects an unknown category rather than inventing a token', () => {
    // Target the event table's cell, not the category table earlier in the page
    const corrupted = s1Content.content.replace(
      'data-title="Category Logged">Apex Code<',
      'data-title="Category Logged">Nonsense Category<',
    );
    expect(() => parseEventTable(corrupted, 'S1', vocab)).toThrow(/unknown log category/);
  });
});

describe('squeezeRow', () => {
  it('drops the surplus empty cell so the columns line up', () => {
    expect(squeezeRow(['CURSOR_FETCH', '', 'fields', 'DB', 'INFO'], 4)).toEqual([
      'CURSOR_FETCH',
      'fields',
      'DB',
      'INFO',
    ]);
  });

  it('leaves a well-formed row alone, including an empty fields cell', () => {
    expect(squeezeRow(['NAME', '', 'DB', 'INFO'], 4)).toEqual(['NAME', '', 'DB', 'INFO']);
  });

  it('refuses a surplus row with nothing to drop', () => {
    expect(() => squeezeRow(['a', 'b', 'c', 'd', 'e'], 4)).toThrow(/cannot be read as 4 columns/);
  });
});

describe('articleHtml', () => {
  it('joins the chunks to exactly the declared length', () => {
    const html = articleHtml(s2Record, 'S2');
    expect(html).toHaveLength(s2Record.Content_Length__c as number);
    expect(html.startsWith('<?xml version="1.0"')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
  });

  it('reads a small article straight from Content__c', () => {
    expect(articleHtml({ Content__c: '<html/>' }, 'S2')).toBe('<html/>');
  });

  it('rejects a join that does not match the declared length', () => {
    const truncated = {
      Content_Length__c: 99,
      Help_Docs_Cache_Details__r: [{ Content__c: '.<html/>.' }],
    };
    expect(() => articleHtml(truncated, 'S2')).toThrow(/declares 99/);
  });

  it('refuses the Content__c decoy rather than parsing the excuse', () => {
    // A large article puts this sentence in Content__c and the body elsewhere
    const decoy = {
      Content_Length__c: 167389,
      Content__c: 'Cannot populate due to large Document size - 167389 characters.',
    };
    expect(() => articleHtml(decoy, 'S2')).toThrow(/declares 167389/);
  });
});

describe('articleRecord', () => {
  it('reads the record from a successful response', () => {
    expect(articleRecord({ record: { Title__c: 'Debug Log Levels' } }, 'S2')).toEqual({
      Title__c: 'Debug Log Levels',
    });
  });

  it('rejects a SUCCESS response that carries no record', () => {
    // What an unpublished release returns: state SUCCESS, no record, HTTP 200
    expect(() => articleRecord({}, 'S2')).toThrow(/no article record returned/);
  });
});

describe('crossCheck', () => {
  it('names the events the developer docs carry and the help site does not', () => {
    const onlyInS1 = crossCheck(s1Events, s2Events)
      .filter((d) => d.reason === 'only-in-s1')
      .map((d) => d.event);

    expect(onlyInS1).toEqual([
      'DATA_ACCESS_EVALUATION',
      'POLICY_RULE_DEFINITION_CONDITION_EVALUATION_RESPONSE',
      'POLICY_RULE_EVALUATION_REQUEST',
      'POLICY_RULE_EVALUATION_RESPONSE',
      'POLICY_RULE_EVALUATION_SKIPPED',
      'POLICY_RULE_EVALUATION_START',
    ]);
  });

  it('finds no category or level disagreement between the two sources', () => {
    const conflicts = crossCheck(s1Events, s2Events).filter(
      (d) => d.reason === 'category' || d.reason === 'level',
    );
    expect(conflicts).toEqual([]);
  });
});

describe('releaseCovers', () => {
  it.each([
    ['62.0', '<=63.0', true],
    ['66.0', '<=63.0', false],
    ['66.0', '66.0', true],
    ['66.0', '67.0', false],
    ['67.0', '>=66.0', true],
  ])('reads %s against %s', (apiVersion, declared, expected) => {
    expect(releaseCovers(apiVersion, declared)).toBe(expected);
  });
});

describe('releaseIdentity', () => {
  it('derives the key, label and date from the Salesforce release name', () => {
    expect(
      releaseIdentity({
        version_text: "Summer '26 (API version 67.0)",
        release_version: '67.0',
        doc_version: '262.0',
      }),
    ).toEqual({
      key: 'summer-26',
      meta: { label: "Summer '26", api_version: '67.0', date: '2026-06' },
    });
  });

  it('dates a Winter release to the previous calendar year', () => {
    // Winter '27 ships in October 2026
    expect(
      releaseIdentity({
        version_text: "Winter '27 preview (API version 68.0)",
        release_version: '68.0',
        doc_version: '264.0',
      }).meta,
    ).toEqual({ label: "Winter '27", api_version: '68.0', date: '2026-10' });
  });
});

describe('resolveRelease', () => {
  const version: DocVersion = {
    version_text: "Summer '26 (API version 67.0)",
    release_version: '67.0',
    doc_version: '262.0',
  };

  it('adds the release when the database does not know it, so no key dangles', () => {
    const releases = {
      'pre-summer-26': { label: "Pre-Summer '26", api_version: '<=63.0', date: '2026-02' },
    };
    const resolved = resolveRelease(version, releases);
    expect(resolved.key).toBe('summer-26');
    expect(resolved.releases[resolved.key]).toEqual({
      label: "Summer '26",
      api_version: '67.0',
      date: '2026-06',
    });
    expect(resolved.changed).toBe(true);
  });

  it('reuses the release the committed database already records', () => {
    expect(resolveRelease(version, database.releases)).toMatchObject({
      key: 'summer-26',
      changed: false,
    });
  });

  it('reuses a release that already covers the version, and reports no change', () => {
    const releases = {
      'summer-26': { label: "Summer '26", api_version: '67.0', date: '2026-06' },
    };
    expect(resolveRelease(version, releases)).toEqual({
      key: 'summer-26',
      releases,
      changed: false,
    });
  });
});

describe('pickDocVersion', () => {
  const metadata: S1Metadata = {
    current: s1Metadata.version,
    available: s1Metadata.available_versions,
  };

  it('defaults to the GA release, never the preview that leads the list', () => {
    expect(pickDocVersion(metadata, null).version_text).not.toMatch(/preview/);
    expect(metadata.available[0]?.version_text).toMatch(/preview/);
  });

  it('honours a published override', () => {
    expect(pickDocVersion(metadata, '66').doc_version).toBe('260.0');
  });

  it('rejects a version that is not published', () => {
    expect(() => pickDocVersion(metadata, '99')).toThrow(/not published/);
  });
});

describe('mergeEvents', () => {
  const run: ScrapeRun = {
    today: '2099-01-01',
    releaseKey: 'summer-26',
    releases: database.releases,
    releasesChanged: false,
    s1: { version: s1Metadata.version, events: s1Events },
    s2: { release: '262.0.0', events: s2Events },
  };

  it('records the check date on each source', () => {
    const { data } = mergeEvents(database, run);
    expect(data.sources.S1).toMatchObject({
      last_checked: '2099-01-01',
      doc_version: '262.0',
      api_version: '67.0',
      event_count: 185,
    });
    expect(data.sources.S2).toMatchObject({
      last_checked: '2099-01-01',
      release: '262.0.0',
      event_count: 179,
    });
  });

  it('leaves the committed database untouched, so only the source dates move', () => {
    const { data, added, changed } = mergeEvents(database, run);
    expect(added).toEqual([]);
    expect(changed).toEqual([]);
    expect(data.events).toEqual(database.events);
    expect(data.version).toBe(database.version);
    expect(data.last_updated).toBe(database.last_updated);
  });

  it('moves last_updated when a release was added but no event changed', () => {
    const { data } = mergeEvents(database, { ...run, releasesChanged: true });
    expect(data.last_updated).toBe('2099-01-01');
    expect(data.version).toBe(database.version);
  });

  it('is idempotent', () => {
    const once = mergeEvents(database, run).data;
    const twice = mergeEvents(once, run).data;
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('bumps the version and dates the event when a fact moves', () => {
    const moved = s1Events.map((e) =>
      e.name === 'BULK_HEAP_ALLOCATE' ? { ...e, level: 'FINE' } : e,
    );
    const { data, changed } = mergeEvents(database, { ...run, s1: { ...run.s1, events: moved } });

    expect(changed).toEqual(['BULK_HEAP_ALLOCATE']);
    expect(data.version).not.toBe(database.version);
    expect(data.last_updated).toBe('2099-01-01');

    const entry = data.events.find((e) => e.event === 'BULK_HEAP_ALLOCATE');
    expect(entry?.last_verified).toBe('2099-01-01');
    expect(entry?.source_levels.S1).toEqual({ category: 'APEX_CODE', level: 'FINE' });
  });

  it('appends a new event against the resolved release', () => {
    const extra: ScrapedEvent = {
      name: 'ZZZ_BRAND_NEW_EVENT',
      category: 'DB',
      level: 'INFO',
      description: 'Something new',
      fields: ['Something new'],
    };
    const { data, added } = mergeEvents(database, {
      ...run,
      s1: { ...run.s1, events: [...s1Events, extra] },
    });

    expect(added).toEqual(['ZZZ_BRAND_NEW_EVENT']);
    expect(data.events.at(-1)).toMatchObject({
      event: 'ZZZ_BRAND_NEW_EVENT',
      official: true,
      release_added: 'summer-26',
      sources: ['S1'],
    });
  });

  it('reports an event the database credits to S1 but S1 no longer lists', () => {
    const withoutOne = s1Events.filter((e) => e.name !== 'BULK_HEAP_ALLOCATE');
    const { notInS1 } = mergeEvents(database, { ...run, s1: { ...run.s1, events: withoutOne } });
    expect(notInS1).toContain('BULK_HEAP_ALLOCATE');
  });

  it('leaves the S2 check date stale when the help site could not be read', () => {
    // A stale date is the signal that this run did not reach that source
    const { data } = mergeEvents(database, { ...run, s2: null });
    expect(data.sources.S1?.last_checked).toBe('2099-01-01');
    expect(data.sources.S2?.last_checked).toBe(database.sources.S2?.last_checked);
    expect(data.sources.S2?.last_checked).not.toBe('2099-01-01');
  });
});
