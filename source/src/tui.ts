import fs from "node:fs/promises";
import { input, search, select } from "@inquirer/prompts";
import { resolveToken } from "./auth.js";
import { resolveCheckoutRoot } from "./checkouts.js";
import { authCheck } from "./commands/auth.js";
import { enrichCommand } from "./commands/enrich.js";
import { infoCommand } from "./commands/info.js";
import { statusCommand } from "./commands/status.js";
import { syncCommand } from "./commands/sync.js";
import { loadConfig, type StrappyConfig } from "./config.js";
import { openStore } from "./db.js";
import { humanSize, timeAgo } from "./format.js";
import { getPaths, type Paths } from "./paths.js";
import type { CheckoutRecord, RepoRecord, StrappyState } from "./state.js";

type MainAction =
  | "dashboard"
  | "repos"
  | "sync"
  | "enrich"
  | "checkouts"
  | "audits"
  | "ask"
  | "settings"
  | "quit";

type RepoAction =
  | "summary"
  | "info"
  | "sync"
  | "enrich"
  | "github"
  | "search"
  | "main";

type SettingsAction = "auth" | "status" | "back";

interface Choice<Value> {
  value: Value;
  name?: string;
  description?: string;
  short?: string;
  disabled?: boolean | string;
}

interface TuiContext {
  paths: Paths;
  config: StrappyConfig;
  checkoutRoot: string;
  state: StrappyState;
  tokenSource: string | null;
}

export async function runTui(): Promise<void> {
  try {
    await ensureCheckoutRoot();
    await showDashboard();

    while (true) {
      const action = await select<MainAction>({
        message: "Strappy",
        pageSize: 10,
        choices: [
          { value: "dashboard", name: "Dashboard", description: "Fleet health summary" },
          { value: "repos", name: "Repos", description: "Search mirrors and run repo actions" },
          { value: "sync", name: "Sync now", description: "Refresh GitHub inventory and mirrors" },
          { value: "enrich", name: "Enrich stale repos", description: "Fetch languages, branches, releases, README" },
          { value: "checkouts", name: "Checkouts", description: "Registered working copies and next checkout work" },
          { value: "audits", name: "Audits", description: "Planned GitHub posture findings" },
          { value: "ask", name: "Ask", description: "Planned Pi-powered repo questions" },
          { value: "settings", name: "Settings", description: "Paths, auth, and config" },
          { value: "quit", name: "Quit" },
        ],
      });

      if (action === "quit") return;
      if (action === "dashboard") await showDashboard();
      else if (action === "repos") await reposView();
      else if (action === "sync") await runCommand("Sync now", () => syncCommand([]));
      else if (action === "enrich") await runCommand("Enrich stale repos", () => enrichCommand([], {}));
      else if (action === "checkouts") await checkoutsView();
      else if (action === "audits") await plannedView("Audits", [
        "This view will store durable findings for branch protection, collaborators, Actions, security, and hygiene.",
        "Next implementation step after checkouts: `strappy audit`, `strappy findings`, and an audit findings table.",
      ]);
      else if (action === "ask") await plannedView("Ask", [
        "This view will use Pi with read-only tools over mirrors, SQLite, checkouts, and audit findings.",
        "Before that, Strappy should build deterministic repo profiles so AI answers have compact evidence.",
      ]);
      else if (action === "settings") await settingsView();
    }
  } catch (err) {
    if (isPromptExit(err)) return;
    throw err;
  }
}

async function showDashboard(): Promise<void> {
  const ctx = await loadTuiContext();
  const repos = Object.values(ctx.state.repos);
  const failures = repos.filter((r) => r.lastSyncOk === false);
  const orphaned = repos.filter((r) => r.orphaned);
  const checkouts = Object.entries(ctx.state.checkouts);
  const totalKb = repos.reduce((sum, r) => sum + (r.sizeKb ?? 0), 0);

  clear();
  title("STRAPPY");
  console.log(`Checkout root  ${ctx.checkoutRoot}`);
  console.log(`STRAPPY_HOME   ${ctx.paths.home}`);
  console.log(`Token          ${ctx.tokenSource ?? "none - run `strappy auth`"}`);
  console.log(`Last sync      ${timeAgo(ctx.state.lastInventoryAt)}`);
  console.log(`Mirrors        ${repos.length} (${humanSize(totalKb)})`);
  console.log(`Failures       ${failures.length}`);
  console.log(`Orphaned       ${orphaned.length}`);
  console.log(`Checkouts      ${checkouts.length}`);
  console.log("");

  const needsAttention = [
    ctx.tokenSource ? null : "danger  No GitHub token configured",
    failures.length ? `danger  ${failures.length} mirror sync failure(s)` : null,
    orphaned.length ? `warn    ${orphaned.length} orphaned mirror(s) kept locally` : null,
    repos.length === 0 ? "info    No repo inventory yet; run Sync now" : null,
    checkouts.length === 0 ? "info    No registered checkouts yet" : null,
  ].filter((line): line is string => line !== null);

  console.log("Needs Attention");
  if (needsAttention.length === 0) console.log("  none");
  else for (const line of needsAttention) console.log(`  ${line}`);

  if (failures.length) {
    console.log("");
    console.log("Recent Failures");
    for (const repo of failures.slice(0, 5)) {
      console.log(`  ${repo.fullName}: ${repo.lastError ?? "unknown error"}`);
    }
  }

  if (checkouts.length) {
    console.log("");
    console.log("Registered Checkouts");
    for (const [name, checkout] of checkouts.slice(0, 5)) {
      console.log(`  ${name.padEnd(18)} ${checkout.repo.padEnd(32)} ${checkout.branch.padEnd(16)} ${checkout.path}`);
    }
  }

  console.log("");
}

async function reposView(): Promise<void> {
  while (true) {
    const ctx = await loadTuiContext();
    const records = Object.values(ctx.state.repos).sort((a, b) => a.fullName.localeCompare(b.fullName));

    clear();
    title("Repos");
    if (records.length === 0) {
      console.log("No repos in inventory. Run Sync now first.");
      await pause();
      return;
    }

    const repo = await search<RepoRecord>({
      message: "Search repos",
      pageSize: 12,
      source: (term) => repoChoices(records, term),
    });

    const next = await repoActions(repo);
    if (next === "main") return;
  }
}

async function repoActions(repo: RepoRecord): Promise<"search" | "main"> {
  while (true) {
    clear();
    printRepoSummary(repo);
    console.log("");

    const action = await select<RepoAction>({
      message: "Repo action",
      choices: [
        { value: "summary", name: "Refresh summary" },
        { value: "info", name: "Show full info", description: "`strappy info` output" },
        { value: "sync", name: "Sync this repo" },
        { value: "enrich", name: "Enrich this repo" },
        { value: "github", name: "Show GitHub URL" },
        { value: "search", name: "Back to repo search" },
        { value: "main", name: "Back to main menu" },
      ],
    });

    if (action === "main" || action === "search") return action;
    if (action === "summary") {
      const refreshed = await findRepo(repo.fullName);
      if (refreshed) repo = refreshed;
      continue;
    }
    if (action === "info") await runCommand(`Info: ${repo.fullName}`, () => infoCommand(repo.fullName, {}));
    else if (action === "sync") await runCommand(`Sync: ${repo.fullName}`, () => syncCommand([repo.fullName]));
    else if (action === "enrich") await runCommand(`Enrich: ${repo.fullName}`, () => enrichCommand([repo.fullName], {}));
    else if (action === "github") {
      console.log("");
      console.log(repo.metadata?.htmlUrl ?? `https://github.com/${repo.fullName}`);
      await pause();
    }

    const refreshed = await findRepo(repo.fullName);
    if (refreshed) repo = refreshed;
  }
}

async function checkoutsView(): Promise<void> {
  const ctx = await loadTuiContext();
  const checkouts = Object.entries(ctx.state.checkouts).sort((a, b) => a[0].localeCompare(b[0]));

  clear();
  title("Checkouts");
  console.log(`Root  ${ctx.checkoutRoot}`);
  console.log("");

  if (checkouts.length === 0) {
    console.log("No registered checkouts yet.");
  } else {
    console.log("name               repo                             branch           path");
    for (const [name, checkout] of checkouts) printCheckout(name, checkout);
  }

  console.log("");
  console.log("Planned next: checkout creation, dirty/ahead scans, relay-push status, and safe cleanup.");
  await pause();
}

async function settingsView(): Promise<void> {
  while (true) {
    const ctx = await loadTuiContext();

    clear();
    title("Settings");
    console.log(`STRAPPY_HOME       ${ctx.paths.home}`);
    console.log(`Checkout root      ${ctx.checkoutRoot}`);
    console.log(`Config             ${ctx.paths.config}`);
    console.log(`Database           ${ctx.paths.db}`);
    console.log(`Token              ${ctx.tokenSource ?? "none"}`);
    console.log(`Owners             ${ctx.config.owners.length ? ctx.config.owners.join(", ") : "(none)"}`);
    console.log(`Include orgs       ${ctx.config.includeOrgs}`);
    console.log(`Concurrency        ${ctx.config.concurrency}`);
    console.log(`Freshness          ${ctx.config.freshnessMinutes} minutes`);
    console.log(`Enrichment max age ${ctx.config.enrichmentMaxAgeDays} days`);
    console.log(`Schedule           ${ctx.config.schedule}`);
    console.log("");

    const action = await select<SettingsAction>({
      message: "Settings action",
      choices: [
        { value: "auth", name: "Check GitHub auth" },
        { value: "status", name: "Print status" },
        { value: "back", name: "Back to main menu" },
      ],
    });

    if (action === "back") return;
    if (action === "auth") await runCommand("GitHub auth", () => authCheck());
    else if (action === "status") await runCommand("Status", () => statusCommand({}));
  }
}

async function plannedView(name: string, lines: string[]): Promise<void> {
  clear();
  title(name);
  for (const line of lines) console.log(line);
  console.log("");
  await pause();
}

async function runCommand(label: string, fn: () => Promise<void>): Promise<void> {
  clear();
  title(label);
  const priorExitCode = process.exitCode;
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("");
    console.log(`Error: ${message}`);
  } finally {
    process.exitCode = priorExitCode;
  }
  console.log("");
  await pause();
}

async function loadTuiContext(): Promise<TuiContext> {
  const paths = getPaths();
  const config = await loadConfig(paths);
  const checkoutRoot = resolveCheckoutRoot(paths, config);
  const store = openStore(paths);
  const state = await store.read();
  const resolved = await resolveToken(paths);
  return {
    paths,
    config,
    checkoutRoot,
    state,
    tokenSource: resolved?.source ?? null,
  };
}

async function ensureCheckoutRoot(): Promise<void> {
  const paths = getPaths();
  const config = await loadConfig(paths);
  await fs.mkdir(resolveCheckoutRoot(paths, config), { recursive: true });
}

function repoChoices(records: RepoRecord[], term: string | undefined): Choice<RepoRecord>[] {
  const needle = term?.trim().toLowerCase() ?? "";
  const filtered = needle
    ? records.filter((repo) => repoSearchText(repo).includes(needle))
    : records;

  return filtered.slice(0, 50).map((repo) => ({
    value: repo,
    name: repoListLine(repo),
    description: repo.metadata?.description ?? undefined,
    short: repo.fullName,
  }));
}

function repoListLine(repo: RepoRecord): string {
  const language = repo.metadata?.language ?? "-";
  const pushed = timeAgo(repo.metadata?.pushedAt ?? repo.lastSync);
  const flags = [
    repo.lastSyncOk === false ? "FAIL" : null,
    repo.orphaned ? "orphaned" : null,
    repo.archived ? "archived" : null,
    repo.private ? "private" : null,
  ]
    .filter(Boolean)
    .join(",");
  return `${repo.fullName.padEnd(38)} ${language.padEnd(12)} ${pushed.padStart(8)} ${flags}`;
}

function repoSearchText(repo: RepoRecord): string {
  return [
    repo.fullName,
    repo.metadata?.language,
    repo.metadata?.description,
    repo.metadata?.topics.join(" "),
    repo.metadata?.licenseSpdx,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function printRepoSummary(repo: RepoRecord): void {
  title(repo.fullName);
  const metadata = repo.metadata;
  if (metadata?.description) console.log(metadata.description);
  console.log("");
  console.log(`Mirror       ${repo.lastSyncOk === false ? "failed" : repo.lastSync ? "synced" : "never"} (${timeAgo(repo.lastSync)})`);
  console.log(`Size         ${humanSize(repo.sizeKb)}`);
  console.log(`Visibility   ${metadata?.visibility ?? (repo.private ? "private" : "public")}`);
  console.log(`Default      ${repo.defaultBranch}`);
  console.log(`Language     ${metadata?.language ?? "-"}`);
  console.log(`Last push    ${timeAgo(metadata?.pushedAt ?? null)}`);
  console.log(`Flags        ${repoFlags(repo).join(", ") || "-"}`);
  if (metadata?.topics.length) console.log(`Topics       ${metadata.topics.join(", ")}`);
  if (repo.enrichment) console.log(`Enrichment   fetched ${timeAgo(repo.enrichment.fetchedAt)}`);
  else console.log("Enrichment   none");
}

function repoFlags(repo: RepoRecord): string[] {
  return [
    repo.private ? "private" : null,
    repo.archived ? "archived" : null,
    repo.orphaned ? "orphaned" : null,
    repo.metadata?.fork ? "fork" : null,
    repo.metadata?.isTemplate ? "template" : null,
  ].filter((flag): flag is string => flag !== null);
}

async function findRepo(fullName: string): Promise<RepoRecord | null> {
  const ctx = await loadTuiContext();
  return ctx.state.repos[fullName] ?? null;
}

function printCheckout(name: string, checkout: CheckoutRecord): void {
  console.log(
    `${name.padEnd(18)} ${checkout.repo.padEnd(32)} ${checkout.branch.padEnd(16)} ${checkout.path}`,
  );
}

async function pause(message = "Press Enter to continue"): Promise<void> {
  await input({ message });
}

function clear(): void {
  console.clear();
}

function title(text: string): void {
  console.log(text);
  console.log("-".repeat(Math.max(12, Math.min(80, text.length))));
}

function isPromptExit(err: unknown): boolean {
  return err instanceof Error && err.name === "ExitPromptError";
}
