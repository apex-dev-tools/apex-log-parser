/**
 * Scrapes Salesforce documentation to update salesforce-debug-log-events.json
 *
 * Both sources are plain HTTP. No browser, no auth, no session.
 *   S1 — Salesforce Developer Docs, the get_document_content endpoint
 *   S2 — Salesforce Help, the Aura ApexActionController endpoint
 *
 * Usage:
 *   pnpm scrape                       # current GA release, discovered from Salesforce
 *   pnpm scrape -- --api-version=66   # a published release, validated before any fetch
 *
 * See scripts/scraper.md for the endpoints and their failure modes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse as parseHtml } from 'node-html-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceLevel {
  category: string;
  level: string;
}

interface EventEntry {
  event: string;
  category: string;
  level: string;
  fields: string[];
  description: string;
  sources: string[];
  official: boolean;
  release_added: string;
  release_deprecated: string | null;
  last_verified: string;
  notes: string | null;
  truncation_protected: boolean;
  source_levels: Record<string, SourceLevel>;
}

interface CategoryMeta {
  name: string;
  label: string;
  description: string;
  default_level: string | null;
}

interface ReleaseMeta {
  label: string;
  api_version: string;
  date: string;
}

interface LogStructure {
  max_size_bytes: number;
  truncation_chunk_bytes: number;
  retention: { system_debug_logs_hours: number; monitoring_debug_logs_days: number };
  generation_limits: { max_mb_per_15min: number; org_max_total_mb: number };
  header_format: string;
  timestamp_format: string;
  delimiter: string;
  session_id_masking: string;
  external_marker: string;
  exclusions: string[];
}

interface CodeUnitTypes {
  description: string;
  source: string;
  types: string[];
}

interface SourceMeta {
  name: string;
  url?: string;
  type: string;
  notes?: string;
  last_checked?: string;
  doc_version?: string;
  api_version?: string;
  release?: string;
  event_count?: number;
}

interface EventsJson {
  $schema: string;
  version: string;
  last_updated: string;
  sources: Record<string, SourceMeta>;
  categories: CategoryMeta[];
  releases: Record<string, ReleaseMeta>;
  log_levels: string[];
  log_structure: LogStructure;
  code_unit_types: CodeUnitTypes;
  events: EventEntry[];
}

interface ScrapedEvent {
  name: string;
  category: string;
  level: string;
  description: string;
  fields: string[];
}

/** One entry of the developer docs `available_versions` array. */
interface DocVersion {
  version_text: string;
  release_version: string;
  doc_version: string;
}

interface S1Metadata {
  /** The release Salesforce currently serves as GA. */
  current: DocVersion;
  available: DocVersion[];
}

/** One source stated an event the other did not, or they stated it differently. */
type Disagreement =
  | { event: string; reason: 'only-in-s1' | 'only-in-s2' }
  | { event: string; reason: 'category' | 'level'; s1: string; s2: string };

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Akamai blocks undici's default `User-Agent: node`, and blocks a
 * browser-impersonating string too. An honest tool name is what passes.
 */
const USER_AGENT =
  'apex-log-parser-scraper/1.0 (+https://github.com/apex-dev-tools/apex-log-parser)';

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches and parses JSON. Both Salesforce sources answer a failed request with
 * `200` and no useful body, so an empty response is an error here, not a result.
 */
async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  let lastStatus = 0;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init?.headers },
    });

    if (res.status === 403) {
      throw new Error(
        `${url} returned 403. Akamai is blocking the request; check the User-Agent, ` +
          'and never set a browser one. Not retried, because the block is deterministic.',
      );
    }

    if (res.ok) {
      const text = await res.text();
      if (text.trim() === '') {
        throw new Error(`${url} returned 200 with an empty body`);
      }
      return JSON.parse(text) as unknown;
    }

    lastStatus = res.status;
    if (!RETRY_STATUSES.has(res.status) || attempt === RETRY_ATTEMPTS) break;

    const backoff = 1000 * 2 ** (attempt - 1);
    console.warn(`  ${url} returned ${res.status}, retrying in ${backoff}ms`);
    await sleep(backoff);
  }

  throw new Error(`${url} returned ${lastStatus}`);
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${context}: expected a non-empty string`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Release identity
// ---------------------------------------------------------------------------

const SEASON_MONTH: Record<string, string> = { spring: '02', summer: '06', winter: '10' };

/**
 * Derives the release key from Salesforce's own `version_text`, e.g.
 * `Summer '26 (API version 67.0)` becomes `summer-26`. A Winter release ships in
 * the previous calendar year, so its date year is one behind its name.
 */
function releaseIdentity(version: DocVersion): { key: string; meta: ReleaseMeta } {
  const match = /^(Spring|Summer|Winter) '(\d{2})/.exec(version.version_text);
  if (!match) {
    throw new Error(`Could not read a season and year from "${version.version_text}"`);
  }

  const season = match[1]!.toLowerCase();
  const year = Number(match[2]!);
  const month = SEASON_MONTH[season]!;
  const dateYear = season === 'winter' ? year - 1 : year;

  return {
    key: `${season}-${match[2]!}`,
    meta: {
      label: `${match[1]!} '${match[2]!}`,
      api_version: version.release_version,
      date: `20${String(dateYear).padStart(2, '0')}-${month}`,
    },
  };
}

/** Reads a release's `api_version`, which may be a bound such as `<=63.0`. */
function releaseCovers(apiVersion: string, declared: string): boolean {
  const match = /^(<=|>=|<|>)?\s*([\d.]+)$/.exec(declared.trim());
  if (!match) return false;

  const bound = Number(match[2]!);
  const value = Number(apiVersion);
  switch (match[1]) {
    case '<=':
      return value <= bound;
    case '>=':
      return value >= bound;
    case '<':
      return value < bound;
    case '>':
      return value > bound;
    default:
      return value === bound;
  }
}

/**
 * Finds the release key for a version, adding the release when the database does
 * not know it yet, so `release_added` can never name a missing key.
 */
function resolveRelease(
  version: DocVersion,
  releases: Record<string, ReleaseMeta>,
): { key: string; releases: Record<string, ReleaseMeta>; changed: boolean } {
  for (const [key, release] of Object.entries(releases)) {
    if (releaseCovers(version.release_version, release.api_version)) {
      return { key, releases, changed: false };
    }
  }

  const identity = releaseIdentity(version);
  return {
    key: identity.key,
    releases: { ...releases, [identity.key]: identity.meta },
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// Event table parsing — shared by both sources
// ---------------------------------------------------------------------------

/** Category labels the documentation spells differently from the database. */
const CATEGORY_LABEL_ALIASES: Record<string, string> = { DB: 'Database' };

/** Salesforce writes `WARNING` in the table; the log token is `WARN`. */
const LEVEL_ALIASES: Record<string, string> = { WARNING: 'WARN' };

/**
 * The tokens a scrape is allowed to produce, taken from the event database so
 * they cannot drift from what the parser and the schema already declare.
 */
interface Vocabulary {
  categoryByLabel: Map<string, string>;
  levels: Set<string>;
}

function vocabulary(data: EventsJson): Vocabulary {
  const categoryByLabel = new Map(data.categories.map((c) => [c.label, c.name]));
  for (const [docLabel, dbLabel] of Object.entries(CATEGORY_LABEL_ALIASES)) {
    const name = categoryByLabel.get(dbLabel);
    if (name === undefined) {
      throw new Error(`Category alias "${docLabel}" points at unknown label "${dbLabel}"`);
    }
    categoryByLabel.set(docLabel, name);
  }
  return { categoryByLabel, levels: new Set(data.log_levels) };
}

const EVENT_TABLE_HEADERS = [
  'Event Name',
  'Fields or Information Logged with Event',
  'Category Logged',
  'Level Logged',
];

/** Below this an apparently successful scrape is treated as a parse failure. */
const MIN_EVENTS = 150;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseFields(description: string): string[] {
  if (!description) return [];
  const normalized = description.replace(/, and /g, ', ');
  return normalized
    .split(', ')
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Squeezes a row back to one cell per column.
 *
 * Salesforce emits the four CURSOR_* rows with an extra empty cell, and assigns
 * its column attributes positionally, so `data-title="Category Logged"` lands on
 * the fields text. Dropping the empty cells restores the real column order —
 * which is why this reads positions and ignores those attributes entirely.
 */
function squeezeRow(cells: string[], width: number): string[] {
  if (cells.length === width) return cells;
  if (cells.length < width) {
    throw new Error(`Row has ${cells.length} cells, expected ${width}: ${cells.join(' | ')}`);
  }

  const kept = [cells[0]!];
  const rest = cells.slice(1);
  const surplus = cells.length - width;
  let dropped = 0;

  for (const cell of rest) {
    if (dropped < surplus && cell === '') {
      dropped++;
      continue;
    }
    kept.push(cell);
  }

  if (kept.length !== width) {
    throw new Error(
      `Row has ${cells.length} cells and only ${dropped} are empty, so it cannot be ` +
        `read as ${width} columns: ${cells.join(' | ')}`,
    );
  }
  return kept;
}

function normaliseLevel(raw: string, event: string, vocab: Vocabulary): string {
  const token = collapse(raw).split(' ')[0]?.toUpperCase() ?? '';
  const level = LEVEL_ALIASES[token] ?? token;
  if (!vocab.levels.has(level)) {
    throw new Error(`${event}: unknown log level "${raw}"`);
  }
  return level;
}

function normaliseCategory(raw: string, event: string, vocab: Vocabulary): string {
  const label = collapse(raw);
  const category = vocab.categoryByLabel.get(label);
  if (category === undefined) {
    throw new Error(
      `${event}: unknown log category "${label}". Add it to the categories list in the ` +
        'event database, then update debugLevelTokenByKey and DebugLevels in src/.',
    );
  }
  return category;
}

/**
 * Reads the debug log event table. Both sources render the same table from the
 * same DITA source, but disagree on every attribute and wrapper element, so the
 * header row is the only reliable anchor.
 */
function parseEventTable(html: string, source: string, vocab: Vocabulary): ScrapedEvent[] {
  const tables = parseHtml(html)
    .querySelectorAll('table')
    .filter((table) => {
      const headers = table.querySelectorAll('th').map((th) => collapse(th.text));
      // Length too, so an added column fails here rather than being squeezed away row by row
      return (
        headers.length === EVENT_TABLE_HEADERS.length &&
        EVENT_TABLE_HEADERS.every((header, i) => headers[i] === header)
      );
    });

  if (tables.length !== 1) {
    throw new Error(
      `${source}: expected exactly one table headed "${EVENT_TABLE_HEADERS.join(' | ')}", ` +
        `found ${tables.length}`,
    );
  }

  const events: ScrapedEvent[] = [];
  const seen = new Set<string>();

  for (const row of tables[0]!.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td').map((td) => collapse(td.text));
    if (cells.length === 0) continue;

    // Six rows carry a parenthetical suffix after the name, and repeat an event
    // that appears elsewhere with a different category. First one wins.
    const name = /^[A-Z][A-Z0-9_]{2,}/.exec(cells[0]!)?.[0];
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const [, description, category, level] = squeezeRow(cells, EVENT_TABLE_HEADERS.length) as [
      string,
      string,
      string,
      string,
    ];

    events.push({
      name,
      category: normaliseCategory(category, name, vocab),
      level: normaliseLevel(level, name, vocab),
      description,
      fields: parseFields(description),
    });
  }

  if (events.length < MIN_EVENTS) {
    throw new Error(
      `${source}: parsed only ${events.length} events, expected at least ${MIN_EVENTS}. ` +
        'The documentation markup has probably changed.',
    );
  }

  return events;
}

// ---------------------------------------------------------------------------
// S1 — Salesforce Developer Docs
// ---------------------------------------------------------------------------

const S1_DOC_SET = 'apexcode';
const S1_PAGE = 'apex_debugging_system_log_console.htm';
const S1_METADATA_URL = `https://developer.salesforce.com/docs/get_document/atlas.en-us.${S1_DOC_SET}.meta`;

function toDocVersion(value: unknown, context: string): DocVersion {
  const record = asRecord(value, context);
  return {
    version_text: asString(record.version_text, `${context}.version_text`),
    release_version: asString(record.release_version, `${context}.release_version`),
    doc_version: asString(record.doc_version, `${context}.doc_version`),
  };
}

/** Reads the published releases, so the doc version is discovered and not computed. */
async function fetchS1Metadata(): Promise<S1Metadata> {
  const body = asRecord(await fetchJson(S1_METADATA_URL), 'S1 metadata');
  const available = Array.isArray(body.available_versions) ? body.available_versions : [];

  return {
    current: toDocVersion(body.version, 'S1 metadata.version'),
    available: available.map((v, i) => toDocVersion(v, `S1 metadata.available_versions[${i}]`)),
  };
}

async function fetchS1Content(docVersion: string): Promise<string> {
  const url = `https://developer.salesforce.com/docs/get_document_content/${S1_DOC_SET}/${S1_PAGE}/en-us/${docVersion}`;
  const body = asRecord(await fetchJson(url), `S1 ${docVersion}`);
  return asString(body.content, `S1 ${docVersion}.content`);
}

// ---------------------------------------------------------------------------
// S2 — Salesforce Help
// ---------------------------------------------------------------------------

const S2_AURA_URL = 'https://help.salesforce.com/s/sfsites/aura';
const S2_ARTICLE = 'platform.code_setting_debug_log_levels.htm';

/**
 * Calls a Help site Apex action.
 *
 * `aura.token=null` is what makes this work unauthenticated. No `fwuid`, cookies
 * or CSRF token are needed, so the SPA shell never has to be scraped.
 */
async function auraAction(
  classname: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const message = JSON.stringify({
    actions: [
      {
        id: '1;a',
        descriptor: 'aura://ApexActionController/ACTION$execute',
        params: { classname, method, params },
      },
    ],
  });

  const body = new URLSearchParams({
    message,
    'aura.context': JSON.stringify({ app: 'siteforce:communityApp' }),
    'aura.token': 'null',
  });

  const response = asRecord(
    await fetchJson(S2_AURA_URL, { method: 'POST', body }),
    `S2 ${classname}.${method}`,
  );

  const actions = Array.isArray(response.actions) ? response.actions : [];
  const action = asRecord(actions[0], `S2 ${classname}.${method}: actions[0]`);
  if (action.state !== 'SUCCESS') {
    throw new Error(`S2 ${classname}.${method} returned state ${String(action.state)}`);
  }

  return asRecord(action.returnValue, `S2 ${classname}.${method}.returnValue`).returnValue;
}

/** The Help site keys its release by doc-set prefix, e.g. `platform`. */
async function fetchS2Release(): Promise<string> {
  const prefix = S2_ARTICLE.split('.')[0]!;
  const releases = asRecord(
    await auraAction('Help_UserReleaseHelper', 'getData', {}),
    'S2 release map',
  );
  return asString(releases[prefix], `S2 release map.${prefix}`);
}

/**
 * Reads the article off a successful response.
 *
 * A release the Help site does not publish answers `state: "SUCCESS"` with no
 * record at all, so the absence of one is the only signal that the release was
 * wrong.
 */
function articleRecord(returned: unknown, context: string): Record<string, unknown> {
  const record = asRecord(returned, context).record;
  if (record === undefined) {
    throw new Error(`${context}: no article record returned. Is the release published?`);
  }
  return asRecord(record, `${context}.record`);
}

/**
 * Joins a chunked article body.
 *
 * `Content__c` on the record is a decoy on a large article — it holds a "cannot
 * populate" sentence. The body arrives split across `Help_Docs_Cache_Details__r`,
 * each chunk wrapped in a leading and trailing `.`.
 */
function joinChunks(chunks: unknown[], context: string): string {
  return chunks
    .map((chunk, i) => {
      const where = `${context} chunk[${i}]`;
      return asString(asRecord(chunk, where).Content__c, where)
        .replace(/^\./, '')
        .replace(/\.$/, '');
    })
    .join('');
}

function articleHtml(record: Record<string, unknown>, context: string): string {
  const chunks = record.Help_Docs_Cache_Details__r;
  const declared = record.Content_Length__c;

  const html =
    Array.isArray(chunks) && chunks.length > 0
      ? joinChunks(chunks, context)
      : asString(record.Content__c, `${context}.Content__c`);

  if (typeof declared === 'number' && html.length !== declared) {
    throw new Error(
      `${context}: joined content is ${html.length} characters, but the record declares ${declared}`,
    );
  }
  return html;
}

async function fetchS2Content(release: string): Promise<string> {
  const context = `S2 ${release}`;
  const returned = await auraAction('Help_ArticleDataController', 'getData', {
    articleParameters: {
      urlName: S2_ARTICLE,
      language: 'en_US',
      release,
      requestedArticleType: 'HelpDocs',
      requestedArticleTypeNumber: '5',
    },
  });

  return articleHtml(articleRecord(returned, context), context);
}

/**
 * Fetches the Help article, tolerating a failure to reach it.
 *
 * Only the fetch is caught. The parse is left to the caller on purpose: the
 * parser is shared with S1, so a drift there would fail the next release too and
 * must not pass as an S2-was-unavailable warning.
 */
async function fetchS2(): Promise<{ release: string; html: string } | null> {
  try {
    const release = await fetchS2Release();
    return { release, html: await fetchS2Content(release) };
  } catch (err) {
    console.warn(`  S2 fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cross-check
// ---------------------------------------------------------------------------

/**
 * Compares the two official sources. Their content is the same table, so a
 * difference is worth a human's attention — but never a failure, because the
 * developer docs legitimately lead the Help site.
 */
function crossCheck(s1Events: ScrapedEvent[], s2Events: ScrapedEvent[]): Disagreement[] {
  const s1Map = new Map(s1Events.map((e) => [e.name, e]));
  const s2Map = new Map(s2Events.map((e) => [e.name, e]));
  const disagreements: Disagreement[] = [];

  for (const [name, s1] of s1Map) {
    const s2 = s2Map.get(name);
    if (!s2) {
      disagreements.push({ event: name, reason: 'only-in-s1' });
      continue;
    }
    if (s1.category !== s2.category) {
      disagreements.push({ event: name, reason: 'category', s1: s1.category, s2: s2.category });
    }
    if (s1.level !== s2.level) {
      disagreements.push({ event: name, reason: 'level', s1: s1.level, s2: s2.level });
    }
  }

  for (const name of s2Map.keys()) {
    if (!s1Map.has(name)) {
      disagreements.push({ event: name, reason: 'only-in-s2' });
    }
  }

  return disagreements.sort((a, b) => a.event.localeCompare(b.event));
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

interface MergeResult {
  data: EventsJson;
  added: string[];
  changed: string[];
  notInS1: string[];
}

interface ScrapeRun {
  today: string;
  releaseKey: string;
  releases: Record<string, ReleaseMeta>;
  releasesChanged: boolean;
  s1: { version: DocVersion; events: ScrapedEvent[] };
  s2: { release: string; events: ScrapedEvent[] } | null;
}

/** Source id to its events by name — one lookup structure for the whole merge. */
type SourceIndex = Map<string, Map<string, ScrapedEvent>>;

function indexSources(run: ScrapeRun): SourceIndex {
  const index: SourceIndex = new Map([['S1', new Map(run.s1.events.map((e) => [e.name, e]))]]);
  if (run.s2) index.set('S2', new Map(run.s2.events.map((e) => [e.name, e])));
  return index;
}

function bumpPatch(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) return version;
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Keeps the written order independent of which source was read first. */
function sortByKey(levels: Record<string, SourceLevel>): Record<string, SourceLevel> {
  return Object.fromEntries(Object.entries(levels).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Records what each source stated about an event.
 *
 * The candidate is built unconditionally and compared as a whole, so a field
 * added here later cannot forget to report itself. `last_verified` moves only
 * when something else moved, which is what leaves an unchanged scrape
 * byte-identical; the check date is recorded once per source, in `sources`.
 */
function refreshEntry(
  entry: EventEntry,
  index: SourceIndex,
  today: string,
): { entry: EventEntry; changed: boolean } {
  const stated = [...index].flatMap(([id, byName]) => {
    const scraped = byName.get(entry.event);
    return scraped ? [[id, scraped] as const] : [];
  });
  if (stated.length === 0) return { entry, changed: false };

  const candidate: EventEntry = { ...entry, source_levels: { ...entry.source_levels } };

  for (const [id, scraped] of stated) {
    candidate.source_levels[id] = { category: scraped.category, level: scraped.level };
    if (!candidate.sources.includes(id)) {
      candidate.sources = [...candidate.sources, id].sort();
    }
    // The index holds only official sources, and the schema defines `official` as
    // "appears in official Salesforce documentation (S1 or S2)"
    candidate.official = true;
    // Only fill description/fields if currently empty, to preserve manual curation
    if (!candidate.description && scraped.description) {
      candidate.description = scraped.description;
      candidate.fields = scraped.fields;
    }
  }

  candidate.source_levels = sortByKey(candidate.source_levels);

  // Compare with the old date in place, so the date itself never counts as a change
  const changed =
    JSON.stringify({ ...candidate, last_verified: entry.last_verified }) !== JSON.stringify(entry);
  if (!changed) return { entry, changed: false };

  return { entry: { ...candidate, last_verified: today }, changed: true };
}

function newEntry(scraped: ScrapedEvent, index: SourceIndex, run: ScrapeRun): EventEntry {
  const source_levels: Record<string, SourceLevel> = {};
  for (const [id, byName] of index) {
    const stated = byName.get(scraped.name);
    if (stated) source_levels[id] = { category: stated.category, level: stated.level };
  }

  return {
    event: scraped.name,
    category: scraped.category,
    level: scraped.level,
    fields: scraped.fields,
    description: scraped.description,
    sources: Object.keys(source_levels).sort(),
    official: true,
    release_added: run.releaseKey,
    release_deprecated: null,
    last_verified: run.today,
    notes: null,
    truncation_protected: false,
    source_levels: sortByKey(source_levels),
  };
}

function refreshSources(existing: EventsJson, run: ScrapeRun): Record<string, SourceMeta> {
  const sources = { ...existing.sources };

  // Spread the stored entry so its key order survives, falling back only when absent
  sources.S1 = {
    ...(sources.S1 ?? { name: 'Salesforce Developer Docs', type: 'official' }),
    last_checked: run.today,
    doc_version: run.s1.version.doc_version,
    api_version: run.s1.version.release_version,
    event_count: run.s1.events.length,
  };

  if (run.s2) {
    sources.S2 = {
      ...(sources.S2 ?? { name: 'Salesforce Help', type: 'official' }),
      last_checked: run.today,
      release: run.s2.release,
      event_count: run.s2.events.length,
    };
  }

  return sources;
}

function mergeEvents(existing: EventsJson, run: ScrapeRun): MergeResult {
  const index = indexSources(run);
  const inS1 = index.get('S1') ?? new Map<string, ScrapedEvent>();
  const changed: string[] = [];
  const notInS1: string[] = [];

  const events = existing.events.map((entry) => {
    if (entry.sources.includes('S1') && !inS1.has(entry.event)) {
      notInS1.push(entry.event);
    }
    const refreshed = refreshEntry(entry, index, run.today);
    if (refreshed.changed) changed.push(entry.event);
    return refreshed.entry;
  });

  // Only S1 introduces an event. The Help site lags it and is a cross-check, so an
  // S2-only name is reported by crossCheck for a human, never added as official.
  const known = new Set(existing.events.map((e) => e.event));
  const added: string[] = [];

  for (const scraped of inS1.values()) {
    if (known.has(scraped.name)) continue;
    known.add(scraped.name);
    events.push(newEntry(scraped, index, run));
    added.push(scraped.name);
  }

  events.sort((a, b) => a.event.localeCompare(b.event));

  const contentChanged = added.length > 0 || changed.length > 0;

  return {
    data: {
      ...existing,
      version: contentChanged ? bumpPatch(existing.version) : existing.version,
      last_updated: contentChanged || run.releasesChanged ? run.today : existing.last_updated,
      sources: refreshSources(existing, run),
      releases: run.releases,
      events,
    },
    added,
    changed,
    notInS1,
  };
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function generateMarkdown(data: EventsJson): string {
  const officialEvents = data.events.filter((e) => e.official);
  const catLabelMap = new Map(data.categories.map((c) => [c.name, c.label]));

  const lines: string[] = [];

  // Header
  lines.push('# Salesforce Debug Log Events Reference');
  lines.push('');
  lines.push(
    `**Source:** [Working with Logs in the Developer Console](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_system_log_console.htm)`,
  );
  lines.push(`**Date Extracted:** ${data.last_updated}`);
  lines.push(
    `**Total Events:** ${officialEvents.length} (official), ${data.events.length} (including unofficial)`,
  );
  lines.push('');

  // Log Structure
  const ls = data.log_structure;
  const maxMb = ls.max_size_bytes / 1024 / 1024;
  const chunkKb = ls.truncation_chunk_bytes / 1024;
  lines.push('## Log Structure');
  lines.push('');
  lines.push(`- **Max size:** ${maxMb} MB`);
  lines.push(`- **Truncation chunk:** ${chunkKb} KB removed when max size reached`);
  lines.push(
    `- **Retention:** System logs ${ls.retention.system_debug_logs_hours}h, Monitoring logs ${ls.retention.monitoring_debug_logs_days} days`,
  );
  lines.push(
    `- **Generation limit:** ${ls.generation_limits.max_mb_per_15min} MB per 15 min window`,
  );
  lines.push(`- **Header format:** \`${ls.header_format}\``);
  lines.push(`- **Timestamp:** \`${ls.timestamp_format}\``);
  lines.push(`- **Field delimiter:** \`${ls.delimiter}\``);
  lines.push(`- **Session IDs:** Replaced with \`${ls.session_id_masking}\``);
  lines.push(`- **Managed package/built-in code:** \`${ls.external_marker}\``);
  lines.push('');
  lines.push(`**Not included in debug logs:** ${ls.exclusions.join(', ')}`);
  lines.push('');

  // Categories
  lines.push('## Debug Log Categories');
  lines.push('');
  lines.push('| Category | Default Level | Description |');
  lines.push('|---|---|---|');
  for (const cat of data.categories) {
    const level = cat.default_level ?? '—';
    lines.push(`| **${cat.label}** | ${level} | ${cat.description} |`);
  }
  lines.push('');
  lines.push('Default levels apply when no trace flags are active (e.g. during Apex tests).');
  lines.push('');

  // Log Levels
  lines.push('## Debug Log Levels');
  lines.push('');
  lines.push(`Log levels (from lowest to highest): ${data.log_levels.join(' < ')}`);
  lines.push('');
  lines.push(
    'The level is cumulative. Selecting FINE includes all events at DEBUG, INFO, WARN, and ERROR levels.',
  );
  lines.push('');

  // Truncation Policy
  const protected_ = data.events.filter((e) => e.truncation_protected);
  lines.push('## Truncation Policy');
  lines.push('');
  lines.push(
    `When a log exceeds ${maxMb} MB, ${chunkKb} KB chunks are removed, usually starting with older lines. Lines can be removed from any location.`,
  );
  lines.push('');
  lines.push(`The following ${protected_.length} events are **never removed** during truncation:`);
  lines.push('');
  for (const e of protected_) {
    lines.push(`- \`${e.event}\``);
  }
  lines.push('');
  lines.push('Content *between* protected start/end pairs may still be removed.');
  lines.push('');

  // Code Unit Types
  const cut = data.code_unit_types;
  lines.push('## Code Unit Types');
  lines.push('');
  lines.push(`${cut.description}`);
  lines.push('');
  for (const t of cut.types) {
    lines.push(`- ${t}`);
  }
  lines.push('');

  // Event Summary by category
  const byCategory = new Map<string, EventEntry[]>();
  for (const e of officialEvents) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  const sortedCategories = [...byCategory.keys()].sort((a, b) => {
    const la = catLabelMap.get(a) ?? a;
    const lb = catLabelMap.get(b) ?? b;
    return la.localeCompare(lb);
  });

  lines.push('## Event Summary');
  lines.push('');
  lines.push('| Category | Event Count |');
  lines.push('|---|---|');
  for (const cat of sortedCategories) {
    const label = catLabelMap.get(cat) ?? cat;
    lines.push(`| ${label} | ${byCategory.get(cat)!.length} |`);
  }
  lines.push(`| **Total (official)** | **${officialEvents.length}** |`);
  lines.push('');

  // All Events alphabetical
  lines.push('## All Events (Alphabetical)');
  lines.push('');
  lines.push('| Event Name | Category | Log Level |');
  lines.push('|---|---|---|');
  for (const e of officialEvents) {
    const label = catLabelMap.get(e.category) ?? e.category;
    lines.push(`| ${e.event} | ${label} | ${e.level} |`);
  }
  lines.push('');

  // Events by category
  lines.push('## Events by Category');
  lines.push('');
  for (const cat of sortedCategories) {
    const label = catLabelMap.get(cat) ?? cat;
    const catEvents = byCategory.get(cat)!;
    lines.push(`### ${label} (${catEvents.length} events)`);
    lines.push(catEvents.map((e) => e.event).join(', '));
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function reportDisagreements(disagreements: Disagreement[]): void {
  if (disagreements.length === 0) {
    console.log('  S1 and S2 agree on every event');
    return;
  }

  console.log(`  S1 and S2 disagree on ${disagreements.length} entries:`);
  for (const d of disagreements) {
    switch (d.reason) {
      case 'only-in-s1':
        console.log(`    only in S1: ${d.event}`);
        break;
      case 'only-in-s2':
        console.log(`    only in S2: ${d.event}`);
        break;
      default:
        console.log(`    ${d.reason} differs: ${d.event} — S1 ${d.s1}, S2 ${d.s2}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function pickDocVersion(metadata: S1Metadata, requested: string | null): DocVersion {
  if (requested === null) return metadata.current;

  const match = metadata.available.find((v) => releaseCovers(requested, v.release_version));
  if (!match) {
    const published = metadata.available.map((v) => v.release_version).join(', ');
    throw new Error(`API version ${requested} is not published. Available: ${published}`);
  }
  return match;
}

async function main(): Promise<void> {
  const requested =
    argv
      .slice(2)
      .find((a) => a.startsWith('--api-version='))
      ?.split('=')[1] ?? null;
  if (requested !== null && !/^\d+(\.\d+)?$/.test(requested)) {
    throw new Error(`--api-version must be a number, got "${requested}"`);
  }

  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../data');
  const jsonPath = join(dataDir, 'salesforce-debug-log-events.json');
  const mdPath = join(dataDir, 'salesforce-debug-log-events.md');
  const existing = JSON.parse(readFileSync(jsonPath, 'utf-8')) as EventsJson;
  const vocab = vocabulary(existing);

  // The two sources are independent, so start S2 before awaiting S1
  const s2Fetch = fetchS2();

  const metadata = await fetchS1Metadata();
  const version = pickDocVersion(metadata, requested);
  console.log(`Scraping ${version.version_text}, doc version ${version.doc_version}`);

  const s1Events = parseEventTable(
    await fetchS1Content(version.doc_version),
    `S1 ${version.doc_version}`,
    vocab,
  );
  console.log(`  S1: ${s1Events.length} events`);

  const fetched = await s2Fetch;
  const s2 = fetched
    ? {
        release: fetched.release,
        events: parseEventTable(fetched.html, `S2 ${fetched.release}`, vocab),
      }
    : null;

  if (s2) {
    console.log(`  S2: ${s2.events.length} events, release ${s2.release}`);
    reportDisagreements(crossCheck(s1Events, s2.events));
  }

  const release = resolveRelease(version, existing.releases);
  const { data, added, changed, notInS1 } = mergeEvents(existing, {
    today: today(),
    releaseKey: release.key,
    releases: release.releases,
    releasesChanged: release.changed,
    s1: { version, events: s1Events },
    s2,
  });

  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(mdPath, generateMarkdown(data));

  console.log('\nResults:');
  console.log(`  Version: ${existing.version} → ${data.version}`);
  console.log(`  Events changed: ${changed.length}`);
  if (added.length > 0) {
    console.log(`  New events added: ${added.length}`);
    for (const name of added) console.log(`    + ${name}`);
  }
  if (notInS1.length > 0) {
    console.log(`  Events with an S1 source but absent from S1 (${notInS1.length}):`);
    for (const name of notInS1) console.log(`    ? ${name}`);
  }

  console.log('\nFiles written:');
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
}

// Guarded so the module can be imported by tests without running a scrape
if (argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    exit(1);
  });
}

export type { DocVersion, EventsJson, S1Metadata, ScrapedEvent, ScrapeRun, Vocabulary };
export {
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
};
