import type { LogEngine } from '../../src/engine/engine.js';

/** The engine's code: the sources, or the bench bundle (`pnpm run bench:bundle`), as dist ships. */
export type EngineCode = 'sources' | 'bundle';

const SOURCES = {
  node: async () => (await import('../../src/engine/node.js')).nodeEngine,
  browser: async () => (await import('../../src/engine/browser.js')).browserEngine,
};

async function fromBundle(file: string): Promise<Record<string, LogEngine>> {
  const url = new URL(`../.bundle/${file}`, import.meta.url).href;
  return import(url).catch((cause: unknown) => {
    throw new Error('No bench bundle: run `pnpm run bench:bundle` first.', { cause });
  });
}

/**
 * The engine of the build `name` states: `node`, the default, or `browser`, from `code`. Imported
 * on demand, so a process holds one build, as in production: each engine keeps an idle builder
 * over its source.
 */
export async function engineNamed(
  name: string | null,
  code: EngineCode = 'sources',
): Promise<LogEngine> {
  const build = name ?? 'node';
  if (!Object.hasOwn(SOURCES, build))
    throw new Error(`No engine is named ${build}. Use node or browser.`);
  if (code === 'sources') return SOURCES[build as keyof typeof SOURCES]();
  // Each entry in benchmarks/bundle/ exports its engine as `<build>Engine`.
  const engine = (await fromBundle(`${build}.js`))[`${build}Engine`];
  if (!engine)
    throw new Error(`The bench bundle has no ${build}Engine: run \`pnpm run bench:bundle\`.`);
  return engine;
}
