import { cleanupCheckouts } from "../checkouts.js";
import { openStore } from "../db.js";
import { getPaths } from "../paths.js";

export interface CleanupCommandOptions {
  all?: boolean;
  force?: boolean;
}

export async function cleanupCommand(
  name: string | undefined,
  opts: CleanupCommandOptions,
): Promise<void> {
  const paths = getPaths();
  const store = openStore(paths);
  const result = await cleanupCheckouts(store, {
    name,
    all: opts.all,
    force: opts.force,
  });

  for (const removed of result.removed) console.log(`Removed ${removed}`);
  for (const missing of result.missing) console.log(`Unregistered missing checkout ${missing}`);
  for (const refused of result.refused) {
    console.log(`Refused ${refused.name}: ${refused.reason}`);
  }

  if (!result.removed.length && !result.missing.length && !result.refused.length) {
    console.log("Nothing to clean.");
  }

  if (result.refused.length) process.exitCode = 1;
}
