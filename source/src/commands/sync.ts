import { resolveToken } from "../auth.js";
import { loadConfig } from "../config.js";
import { enrich } from "../enrich.js";
import { humanSize } from "../format.js";
import { openStore } from "../db.js";
import { Logger } from "../logger.js";
import { getPaths } from "../paths.js";
import { sync } from "../sync.js";

export async function syncCommand(repos: string[]): Promise<void> {
  const paths = getPaths();
  const config = await loadConfig(paths);
  const logger = new Logger(paths.logFile, "cli");

  const resolved = await resolveToken(paths);
  if (!resolved) {
    throw new Error(
      "No GitHub token found. Set STRAPPY_GITHUB_TOKEN in .env, or run `strappy auth`.",
    );
  }

  const store = openStore(paths);
  const summary = await sync({
    store,
    paths,
    config,
    token: resolved.token,
    logger,
    only: repos.length ? repos : undefined,
  });

  console.log("");
  console.log(
    `Synced ${summary.results.length} repo(s) from an inventory of ${summary.inventoryCount}:`,
  );
  for (const r of summary.results) {
    const tag = r.action === "failed" ? "✗ FAILED" : r.action === "cloned" ? "✓ cloned " : "✓ updated";
    const size = r.action === "failed" ? r.error ?? "" : humanSize(r.sizeKb);
    console.log(`  ${tag}  ${r.fullName}  ${size}`);
  }
  if (summary.renamed.length) {
    console.log("");
    for (const mv of summary.renamed) console.log(`  ↦ renamed ${mv.from} -> ${mv.to}`);
  }
  if (summary.orphaned.length) {
    console.log("");
    console.log(`  ${summary.orphaned.length} orphaned (gone from GitHub, mirror kept):`);
    for (const name of summary.orphaned) console.log(`    • ${name}`);
  }
  console.log("");
  console.log(`Result: ${summary.ok} ok, ${summary.failed} failed.`);

  if (summary.failed > 0) process.exitCode = 1;

  console.log("");
  console.log("Refreshing stale enrichment:");
  const enrichment = await enrich({
    store,
    config,
    token: resolved.token,
    logger,
    only: repos.length ? repos : undefined,
  });

  if (enrichment.results.length === 0) {
    console.log(
      enrichment.skipped > 0
        ? `All ${enrichment.skipped} repo(s) already fresh (within ${config.enrichmentMaxAgeDays}d). Use \`strappy enrich --force\` to refetch.`
        : "No repos in inventory.",
    );
  } else {
    console.log(
      `Enriched ${enrichment.ok} repo(s), ${enrichment.failed} failed, ${enrichment.skipped} fresh.`,
    );
    for (const r of enrichment.results.filter((x) => !x.ok)) {
      console.log(`  ✗ ${r.fullName}: ${r.error}`);
    }
  }

  if (enrichment.failed > 0) process.exitCode = 1;
}
