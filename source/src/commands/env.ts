import path from "node:path";
import {
  listEnvironmentProfiles,
  restoreEnvironment,
  saveEnvironment,
} from "../environments.js";
import { openStore } from "../db.js";
import { getPaths, splitFullName } from "../paths.js";
import { resolveRepo } from "../checkouts.js";

export interface EnvSaveOptions {
  from?: string;
  profile?: string;
  path?: string[];
}

export interface EnvRestoreOptions {
  to?: string;
  profile?: string;
  path?: string[];
  overwrite?: boolean;
}

export interface EnvListOptions {
  json?: boolean;
}

export async function envSaveCommand(
  repoArg: string,
  pathArgs: string[],
  opts: EnvSaveOptions,
): Promise<void> {
  const paths = getPaths();
  const store = openStore(paths);
  const state = await store.read();
  const repo = resolveEnvironmentRepo(Object.values(state.repos), repoArg);
  const checkoutPath = path.resolve(opts.from?.trim() || process.cwd());
  const filePaths = [...pathArgs, ...(opts.path ?? [])];
  const profile = opts.profile?.trim() || "default";

  const result = await saveEnvironment({
    paths,
    repo,
    profile,
    checkoutPath,
    filePaths,
  });

  console.log(`Saved ${result.saved.length} file(s) for ${result.manifest.repo} profile "${result.manifest.profile}".`);
  console.log(`Path ${path.join(paths.environments, ...result.manifest.repo.split("/"))}`);
  for (const entry of result.saved) console.log(`- ${entry.path}`);
}

export async function envRestoreCommand(
  repoArg: string,
  opts: EnvRestoreOptions,
): Promise<void> {
  const paths = getPaths();
  const store = openStore(paths);
  const state = await store.read();
  const repo = resolveEnvironmentRepo(Object.values(state.repos), repoArg);
  const checkoutPath = path.resolve(opts.to?.trim() || process.cwd());
  const profile = opts.profile?.trim() || "default";

  const result = await restoreEnvironment({
    paths,
    repo,
    profile,
    checkoutPath,
    filePaths: opts.path,
    overwrite: opts.overwrite,
  });

  console.log(`Restored ${result.restored.length} file(s) for ${result.manifest.repo} profile "${result.manifest.profile}".`);
  if (result.unchanged.length) console.log(`${result.unchanged.length} file(s) already matched.`);
  for (const entry of result.restored) console.log(`- ${entry.path}`);
  for (const refused of result.refused) console.log(`Refused ${refused.path}: ${refused.reason}`);
  if (result.refused.length) process.exitCode = 1;
}

export async function envListCommand(
  repoArg: string | undefined,
  opts: EnvListOptions,
): Promise<void> {
  const paths = getPaths();
  let repo: string | undefined;
  if (repoArg) {
    const store = openStore(paths);
    const state = await store.read();
    repo = resolveEnvironmentRepo(Object.values(state.repos), repoArg);
  }

  const profiles = await listEnvironmentProfiles(paths, repo);
  if (opts.json) {
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  if (profiles.length === 0) {
    console.log(repo ? `No saved environments for ${repo}.` : "No saved environments.");
    return;
  }

  const repoWidth = Math.min(48, Math.max(...profiles.map((profile) => profile.repo.length)));
  for (const profile of profiles) {
    console.log(
      `${profile.repo.padEnd(repoWidth)}  ${profile.profile.padEnd(16)}  ` +
        `${String(profile.fileCount).padStart(3)} file(s)  ${profile.savedAt ?? "unknown"}`,
    );
  }
  console.log(`\n${profiles.length} environment profile(s).`);
}

function resolveEnvironmentRepo(records: Parameters<typeof resolveRepo>[0], repoArg: string): string {
  try {
    return resolveRepo(records, repoArg).fullName;
  } catch (err) {
    if (!repoArg.includes("/")) throw err;
    splitFullName(repoArg);
    return repoArg;
  }
}
