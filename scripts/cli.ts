/**
 * What every script here needs to be a command: argument reading and an entry
 * point.
 *
 * Deliberately free of other imports, so a small script does not pull the
 * scraper's module graph in to read one flag.
 */

import { realpathSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Reads `--name=value`. Slices rather than splits, so a value may contain `=`.
 *
 * The space-separated form is refused by name: taking it as absent would let a
 * scrape finish having written no run record, and fail two steps later on ENOENT.
 */
export function flag(args: string[], name: string): string | null {
  if (args.includes(name)) throw new Error(`${name} needs a value, written ${name}=<value>`);

  const prefix = `${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null;
}

/**
 * Runs `main` only when this module is what the process was asked to run, so a
 * test can import it without side effects.
 *
 * Both paths are realpathed: Node resolves `import.meta.url` but `argv[1]` keeps
 * the path as typed, so a symlinked checkout would otherwise make every script a
 * silent no-op.
 */
export function runIfMain(moduleUrl: string, main: () => unknown): void {
  if (realpathSync(argv[1] ?? '') !== realpathSync(fileURLToPath(moduleUrl))) return;

  Promise.resolve()
    .then(main)
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      exit(1);
    });
}
