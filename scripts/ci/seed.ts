/**
 * Seeds `data/` from the open automation branch before a scrape.
 *
 * Without this the job rebuilds from the base branch. No event is lost, because
 * the scrape reads the current documentation absolutely rather than
 * incrementally, but an event added in one release gets relabelled with the next
 * one, and any curation on the open branch — a description, a note, a
 * `truncation_protected` flag — is force-pushed away.
 *
 * Usage:
 *   pnpm run ci:seed -- --branch=auto/scrape-debug-log-events
 *
 * SEED_BRANCH is read when --branch is absent. Needs the remote ref present, so
 * the checkout must be unshallow.
 */

import { spawnSync } from 'node:child_process';
import { argv, env } from 'node:process';
import { flag, runIfMain } from '../cli.js';

/** Runs git without a shell, so a branch name is an argument and never code. */
function git(...args: string[]): { status: number; stderr: string } {
  const result = spawnSync('git', args, { encoding: 'utf-8' });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stderr: result.stderr };
}

/** True when the branch existed and its `data/` was checked out. */
export function seed(branch: string): boolean {
  const ref = `origin/${branch}`;
  // rev-parse exits 1 for a ref that is not there and 128 for a real failure, such
  // as a shallow clone that never fetched it. Reading the second as "absent" would
  // rebuild data/ from the base branch and force-push away the curation this step
  // exists to keep, saying nothing but "starting from the base branch".
  const verify = git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  if (verify.status === 1) {
    console.log(`No ${ref}; starting from the base branch`);
    return false;
  }
  if (verify.status !== 0) {
    throw new Error(
      `Could not look up ${ref}: git exited ${verify.status}. ${verify.stderr.trim()}`,
    );
  }

  const checkout = git('checkout', ref, '--', 'data/');
  if (checkout.status !== 0) {
    throw new Error(`Could not read data/ from ${ref}: ${checkout.stderr.trim()}`);
  }
  console.log(`Seeded data/ from ${ref}`);
  return true;
}

function main(): void {
  const branch = flag(argv.slice(2), '--branch') ?? env.SEED_BRANCH ?? '';
  if (branch === '') throw new Error('--branch=<name> or SEED_BRANCH is required');
  seed(branch);
}

runIfMain(import.meta.url, main);
