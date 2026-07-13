/**
 * Scrapes Salesforce documentation to update salesforce-debug-log-events.json
 *
 * Sources:
 *   S1 — Salesforce Developer Docs (public REST API, no auth required)
 *   S2 — Salesforce Help (client-rendered SPA, scraped via Playwright)
 *
 * Usage:
 *   pnpm scrape                         # default API version (66.0)
 *   pnpm scrape -- --api-version=65     # specific Salesforce API version
 *   pnpm scrape -- --skip-s2            # skip Playwright scrape (S2)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse as parseHtml } from 'node-html-parser';
import { chromium } from 'playwright';

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

interface EventsJson {
  $schema: string;
  version: string;
  last_updated: string;
  sources: Record<string, { name: string; url?: string; type: string; notes?: string }>;
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

// ---------------------------------------------------------------------------
// Category & release helpers
// ---------------------------------------------------------------------------

const S1_CATEGORY_MAP: Record<string, string> = {
  'Apex Code': 'APEX_CODE',
  'Apex Profiling': 'APEX_PROFILING',
  Callout: 'CALLOUT',
  DB: 'DB',
  'Data Access': 'DATA_ACCESS',
  NBA: 'NBA',
  System: 'SYSTEM',
  Validation: 'VALIDATION',
  Visualforce: 'VISUALFORCE',
  Workflow: 'WORKFLOW',
};

const S2_CATEGORY_MAP: Record<string, string> = {
  ...S1_CATEGORY_MAP,
  Database: 'DB',
};

function docVersionFromApiVersion(apiVersion: number): number {
  return (apiVersion - 60) * 2 + 248;
}

function getReleaseKey(apiVersion: number, releases: Record<string, ReleaseMeta>): string {
  for (const [key, release] of Object.entries(releases)) {
    if (release.api_version.includes(String(apiVersion))) return key;
  }
  // Generate key from Salesforce release cycle (3 releases/year starting Spring '24 = 60.0)
  const offset = Math.round(apiVersion) - 60;
  const seasonNames = ['spring', 'summer', 'winter'];
  const season = seasonNames[offset % 3];
  const year = 2024 + Math.floor(offset / 3);
  return `${season}-${String(year).slice(2)}`;
}

function parseFields(description: string): string[] {
  if (!description) return [];
  const normalized = description.replace(/, and /g, ', ');
  return normalized
    .split(', ')
    .map((f) => f.trim())
    .filter(Boolean);
}

function bumpPatch(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) return version;
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// S1 — Salesforce Developer Docs
// ---------------------------------------------------------------------------

async function fetchS1Html(apiVersion: number): Promise<string> {
  const docVersion = docVersionFromApiVersion(apiVersion);
  const base =
    'https://developer.salesforce.com/docs/get_document_content/apexcode/apex_debugging_system_log_console.htm/en-us';

  for (const v of [docVersion, docVersion - 2]) {
    const url = `${base}/${v}.0`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as { content: string };
      return data.content;
    }
    console.warn(`  S1: version ${v}.0 returned ${res.status}`);
  }

  throw new Error('S1: could not fetch content for any doc version');
}

function parseS1Events(html: string): ScrapedEvent[] {
  const root = parseHtml(html);
  const events: ScrapedEvent[] = [];
  const seen = new Set<string>();

  for (const row of root.querySelectorAll('tr')) {
    const nameEl = row.querySelector('td[data-title="Event Name"] samp.codeph');
    if (!nameEl) continue;

    const name = nameEl.text.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const categoryRaw = row.querySelector('td[data-title="Category Logged"]')?.text.trim() ?? '';
    const levelRaw = row.querySelector('td[data-title="Level Logged"]')?.text.trim() ?? '';
    const descRaw =
      row
        .querySelector('td[data-title="Fields or Information Logged with Event"]')
        ?.text.trim()
        .replace(/\s+/g, ' ') ?? '';

    const category = S1_CATEGORY_MAP[categoryRaw] ?? categoryRaw.toUpperCase().replace(/\s+/g, '_');
    const level = levelRaw.split(/\s/)[0] ?? 'INFO';

    events.push({ name, category, level, description: descRaw, fields: parseFields(descRaw) });
  }

  return events;
}

async function fetchS1Events(apiVersion: number): Promise<ScrapedEvent[]> {
  const html = await fetchS1Html(apiVersion);
  return parseS1Events(html);
}

// ---------------------------------------------------------------------------
// S2 — Salesforce Help (Playwright)
// ---------------------------------------------------------------------------

async function fetchS2Events(): Promise<ScrapedEvent[]> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(
      'https://help.salesforce.com/s/articleView?id=platform.code_setting_debug_log_levels.htm&language=en_US&type=5',
      { waitUntil: 'networkidle', timeout: 30000 },
    );

    // Accept cookie consent if present
    const cookieBtn = page.locator(
      'button:has-text("Accept All"), button:has-text("Accept"), button:has-text("Allow All")',
    );
    if ((await cookieBtn.count()) > 0) {
      await cookieBtn.first().click();
      await page.waitForTimeout(1000);
    }

    // Wait for article body to render
    await page
      .waitForSelector('article, .slds-rich-text-editor__output, [data-component-id]', {
        timeout: 20000,
      })
      .catch(() => {
        /* continue even if selector not found */
      });

    const html = await page.content();
    return parseS2Events(html);
  } finally {
    await browser.close();
  }
}

function parseS2Events(html: string): ScrapedEvent[] {
  const root = parseHtml(html);
  const events: ScrapedEvent[] = [];
  const seen = new Set<string>();

  for (const row of root.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;

    for (let i = 0; i < cells.length; i++) {
      const text = cells[i].text.trim();
      // Match Salesforce event name pattern: ALL_CAPS with underscores
      if (!/^[A-Z][A-Z0-9_]{2,}$/.test(text) || !text.includes('_')) continue;
      if (seen.has(text)) continue;
      seen.add(text);

      const cellTexts = Array.from(cells).map((c) => c.text.trim());
      let category = '';
      let level = '';

      for (let j = i + 1; j < cellTexts.length; j++) {
        const ct = cellTexts[j];
        if (!level && /^(NONE|ERROR|WARN|INFO|DEBUG|FINE[R]?[S]?T?)/.test(ct)) {
          level = ct.split(/\s/)[0];
        }
        if (!category) {
          const mapped = S2_CATEGORY_MAP[ct];
          if (mapped) category = mapped;
        }
      }

      if (category || level) {
        events.push({ name: text, category, level: level || 'INFO', description: '', fields: [] });
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

interface MergeResult {
  data: EventsJson;
  added: string[];
  updated: string[];
  notInS1: string[];
}

function mergeEvents(
  existing: EventsJson,
  s1Events: ScrapedEvent[],
  s2Events: ScrapedEvent[],
  releaseKey: string,
): MergeResult {
  const s1Map = new Map(s1Events.map((e) => [e.name, e]));
  const s2Map = new Map(s2Events.map((e) => [e.name, e]));
  const todayStr = today();

  const added: string[] = [];
  const updated: string[] = [];
  const notInS1: string[] = [];

  const updatedEvents: EventEntry[] = existing.events.map((entry) => {
    const s1 = s1Map.get(entry.event);
    const s2 = s2Map.get(entry.event);

    if (!s1 && entry.sources.includes('S1')) {
      notInS1.push(entry.event);
    }

    if (!s1 && !s2) return entry;

    const result: EventEntry = { ...entry, source_levels: { ...entry.source_levels } };

    if (s1) {
      result.source_levels.S1 = { category: s1.category, level: s1.level };
      result.last_verified = todayStr;
      if (!result.official) result.official = true;
      if (!entry.sources.includes('S1')) {
        result.sources = [...entry.sources, 'S1'].sort();
      }
      // Only fill description/fields if currently empty (preserve manual curation)
      if (!entry.description && s1.description) {
        result.description = s1.description;
        result.fields = s1.fields;
      }
      updated.push(entry.event);
    }

    if (s2?.category) {
      result.source_levels.S2 = { category: s2.category, level: s2.level };
      if (!result.sources.includes('S2')) {
        result.sources = [...result.sources, 'S2'].sort();
      }
    }

    return result;
  });

  // Append new events found in S1
  const existingNames = new Set(existing.events.map((e) => e.event));
  for (const s1 of s1Events) {
    if (existingNames.has(s1.name)) continue;

    const s2 = s2Map.get(s1.name);
    const sourceLevels: Record<string, SourceLevel> = {
      S1: { category: s1.category, level: s1.level },
    };
    if (s2?.category) {
      sourceLevels.S2 = { category: s2.category, level: s2.level };
    }

    const newEntry: EventEntry = {
      event: s1.name,
      category: s1.category,
      level: s1.level,
      fields: s1.fields,
      description: s1.description,
      sources: s2?.category ? ['S1', 'S2'] : ['S1'],
      official: true,
      release_added: releaseKey,
      release_deprecated: null,
      last_verified: todayStr,
      notes: null,
      truncation_protected: false,
      source_levels: sourceLevels,
    };
    updatedEvents.push(newEntry);
    added.push(s1.name);
  }

  updatedEvents.sort((a, b) => a.event.localeCompare(b.event));

  return {
    data: {
      ...existing,
      version: bumpPatch(existing.version),
      last_updated: todayStr,
      events: updatedEvents,
    },
    added,
    updated,
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = argv.slice(2);
  const apiVersionArg = args.find((a) => a.startsWith('--api-version='));
  const apiVersion = apiVersionArg ? Number.parseFloat(apiVersionArg.split('=')[1]!) : 66.0;
  const skipS2 = args.includes('--skip-s2');

  console.log(`Scraping Salesforce debug log events (API ${apiVersion})...`);

  const s2Promise = skipS2
    ? Promise.resolve<ScrapedEvent[]>([])
    : fetchS2Events().catch((err: Error) => {
        console.warn(`  S2 scrape failed: ${err.message}`);
        console.warn(
          '  Run "pnpm scrape:install" to install Playwright browsers, or use --skip-s2',
        );
        return [] as ScrapedEvent[];
      });

  const [s1Events, s2Events] = await Promise.all([
    fetchS1Events(apiVersion).catch((err: Error) => {
      console.error(`  S1 scrape failed: ${err.message}`);
      return [] as ScrapedEvent[];
    }),
    s2Promise,
  ]);

  console.log(`  S1: ${s1Events.length} events scraped`);
  console.log(`  S2: ${s2Events.length} events scraped`);

  if (s1Events.length === 0) {
    console.error('No events from S1 — aborting to avoid overwriting with empty data.');
    exit(1);
  }

  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../data');
  const jsonPath = join(dataDir, 'salesforce-debug-log-events.json');
  const mdPath = join(dataDir, 'salesforce-debug-log-events.md');

  const existing = JSON.parse(readFileSync(jsonPath, 'utf-8')) as EventsJson;
  const releaseKey = getReleaseKey(apiVersion, existing.releases);

  const { data, added, updated, notInS1 } = mergeEvents(existing, s1Events, s2Events, releaseKey);

  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(mdPath, generateMarkdown(data));

  console.log('\nResults:');
  console.log(`  Version: ${existing.version} → ${data.version}`);
  console.log(`  Events updated (S1 data refreshed): ${updated.length}`);
  if (added.length > 0) {
    console.log(`  New events added: ${added.length}`);
    for (const name of added) console.log(`    + ${name}`);
  }
  if (notInS1.length > 0) {
    console.log(`  Events with S1 source but not found in S1 (${notInS1.length}):`);
    for (const name of notInS1) console.log(`    ? ${name}`);
  }

  console.log('\nFiles written:');
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
}

main().catch((err: Error) => {
  console.error(err);
  exit(1);
});

// Re-export for testing
export { parseS1Events, parseS2Events, mergeEvents, generateMarkdown, bumpPatch, getReleaseKey };
