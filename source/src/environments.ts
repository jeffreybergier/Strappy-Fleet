import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";
import { splitFullName, type Paths } from "./paths.js";

export interface EnvironmentManifest {
  version: 1;
  repo: string;
  profile: string;
  savedAt: string;
  files: EnvironmentFileEntry[];
}

export interface EnvironmentFileEntry {
  path: string;
  mode: string;
  size: number;
  sha256: string;
  savedAt: string;
  sourceCheckout: string | null;
}

export interface SaveEnvironmentOptions {
  paths: Paths;
  repo: string;
  profile: string;
  checkoutPath: string;
  filePaths: string[];
}

export interface SaveEnvironmentResult {
  manifest: EnvironmentManifest;
  saved: EnvironmentFileEntry[];
}

export interface RestoreEnvironmentOptions {
  paths: Paths;
  repo: string;
  profile: string;
  checkoutPath: string;
  filePaths?: string[];
  overwrite?: boolean;
}

export interface RestoreEnvironmentResult {
  manifest: EnvironmentManifest;
  restored: EnvironmentFileEntry[];
  unchanged: EnvironmentFileEntry[];
  refused: { path: string; reason: string }[];
}

export interface EnvironmentProfileSummary {
  repo: string;
  profile: string;
  path: string;
  savedAt: string | null;
  fileCount: number;
}

export interface EnvironmentRepoSummary {
  repo: string;
  path: string;
  updatedAt: string | null;
  fileCount: number;
}

interface StoredEnvironmentManifest {
  version: 2;
  repo: string;
  updatedAt: string;
  profiles: Record<string, StoredEnvironmentProfile>;
}

interface StoredEnvironmentProfile {
  savedAt: string;
  files: EnvironmentFileEntry[];
}

export async function saveEnvironment(opts: SaveEnvironmentOptions): Promise<SaveEnvironmentResult> {
  const repo = validateRepo(opts.repo);
  const profile = validateProfile(opts.profile);
  const checkoutRoot = path.resolve(opts.checkoutPath);
  const relPaths = uniqueNormalizedPaths(opts.filePaths);
  if (relPaths.length === 0) throw new Error("Choose at least one environment file path to save.");

  const stored = (await readStoredManifest(opts.paths, repo, { allowMissing: true })) ?? emptyStoredManifest(repo);
  const existingProfile = stored.profiles[profile];
  const entriesByPath = new Map((existingProfile?.files ?? []).map((entry) => [entry.path, entry]));
  const savedAt = new Date().toISOString();
  const saved: EnvironmentFileEntry[] = [];
  const repoDir = environmentRepoPath(opts.paths, repo);

  for (const rel of relPaths) {
    const source = safeJoin(checkoutRoot, rel);
    const sourceStat = await checkedSourceFile(source, rel);
    const mode = restoreModeFromSource(sourceStat.mode);
    const sha256 = await hashFile(source);
    const dest = safeJoin(repoDir, rel);

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
    await fs.chmod(dest, mode);

    const entry: EnvironmentFileEntry = {
      path: rel,
      mode: formatMode(mode),
      size: sourceStat.size,
      sha256,
      savedAt,
      sourceCheckout: checkoutRoot,
    };
    entriesByPath.set(rel, entry);
    saved.push(entry);
  }

  const manifest: EnvironmentManifest = {
    version: 1,
    repo,
    profile,
    savedAt,
    files: [...entriesByPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
  stored.updatedAt = savedAt;
  stored.profiles[profile] = {
    savedAt,
    files: manifest.files,
  };
  await writeStoredManifest(opts.paths, stored);
  return { manifest, saved };
}

export async function restoreEnvironment(opts: RestoreEnvironmentOptions): Promise<RestoreEnvironmentResult> {
  const repo = validateRepo(opts.repo);
  const profile = validateProfile(opts.profile);
  const checkoutRoot = path.resolve(opts.checkoutPath);
  const manifest = await readEnvironmentManifest(opts.paths, repo, profile);
  const wanted = opts.filePaths?.length ? new Set(uniqueNormalizedPaths(opts.filePaths)) : null;
  const entries = wanted ? manifest.files.filter((entry) => wanted.has(entry.path)) : manifest.files;
  const missing = wanted ? [...wanted].filter((rel) => !manifest.files.some((entry) => entry.path === rel)) : [];
  const toRestore: { entry: EnvironmentFileEntry; source: string; target: string }[] = [];
  const unchanged: EnvironmentFileEntry[] = [];
  const refused: { path: string; reason: string }[] = missing.map((rel) => ({
    path: rel,
    reason: "not present in environment manifest",
  }));

  for (const entry of entries) {
    const rel = validateRelativePath(entry.path);
    const source = safeJoin(environmentRepoPath(opts.paths, repo), rel);
    const target = safeJoin(checkoutRoot, rel);
    const sourceStat = await checkedStoredFile(source, rel);
    if (sourceStat.size !== entry.size || (await hashFile(source)) !== entry.sha256) {
      refused.push({ path: rel, reason: "stored file no longer matches manifest" });
      continue;
    }
    const current = await existingTarget(target);

    if (current?.isSymbolicLink()) {
      refused.push({ path: rel, reason: "target is a symlink" });
      continue;
    }
    if (current && !current.isFile()) {
      refused.push({ path: rel, reason: "target exists and is not a file" });
      continue;
    }
    if (current && !opts.overwrite) {
      const currentHash = await hashFile(target);
      if (currentHash === entry.sha256) {
        unchanged.push(entry);
        continue;
      }
      refused.push({ path: rel, reason: "target exists and differs; pass --overwrite to replace it" });
      continue;
    }

    toRestore.push({ entry, source, target });
  }

  if (refused.length) return { manifest, restored: [], unchanged, refused };

  const restored: EnvironmentFileEntry[] = [];
  for (const item of toRestore) {
    await fs.mkdir(path.dirname(item.target), { recursive: true });
    await fs.copyFile(item.source, item.target);
    await fs.chmod(item.target, parseMode(item.entry.mode));
    restored.push(item.entry);
  }

  return { manifest, restored, unchanged, refused };
}

export async function listEnvironmentProfiles(
  paths: Paths,
  repo?: string,
): Promise<EnvironmentProfileSummary[]> {
  const manifests = repo
    ? [await readStoredManifest(paths, validateRepo(repo), { allowMissing: true })]
    : await listStoredManifests(paths);
  const summaries: EnvironmentProfileSummary[] = [];

  for (const stored of manifests) {
    if (!stored) continue;
    for (const [profile, profileManifest] of Object.entries(stored.profiles)) {
      summaries.push({
        repo: stored.repo,
        profile,
        path: environmentRepoPath(paths, stored.repo),
        savedAt: profileManifest.savedAt,
        fileCount: profileManifest.files.length,
      });
    }
  }

  return summaries.sort((a, b) => a.repo.localeCompare(b.repo) || a.profile.localeCompare(b.profile));
}

export async function listEnvironmentRepositories(
  paths: Paths,
  repo?: string,
): Promise<EnvironmentRepoSummary[]> {
  const manifests = repo
    ? [await readStoredManifest(paths, validateRepo(repo), { allowMissing: true })]
    : await listStoredManifests(paths);
  const summaries: EnvironmentRepoSummary[] = [];

  for (const stored of manifests) {
    if (!stored) continue;
    const filePaths = new Set<string>();
    for (const profile of Object.values(stored.profiles)) {
      for (const entry of profile.files) filePaths.add(entry.path);
    }
    summaries.push({
      repo: stored.repo,
      path: environmentRepoPath(paths, stored.repo),
      updatedAt: stored.updatedAt || null,
      fileCount: filePaths.size,
    });
  }

  return summaries.sort((a, b) => a.repo.localeCompare(b.repo));
}

export async function readEnvironmentManifest(
  paths: Paths,
  repo: string,
  profile: string,
  opts?: { allowMissing?: false },
): Promise<EnvironmentManifest>;
export async function readEnvironmentManifest(
  paths: Paths,
  repo: string,
  profile: string,
  opts: { allowMissing: true },
): Promise<EnvironmentManifest | null>;
export async function readEnvironmentManifest(
  paths: Paths,
  repo: string,
  profile: string,
  opts: { allowMissing?: boolean } = {},
): Promise<EnvironmentManifest | null> {
  const stored = await readStoredManifest(paths, repo, { allowMissing: opts.allowMissing ?? false });
  if (!stored) return null;
  const normalizedProfile = validateProfile(profile);
  const profileManifest = stored.profiles[normalizedProfile];
  if (!profileManifest && opts.allowMissing) return null;
  if (!profileManifest) throw new Error(`No saved environment for ${repo} profile "${profile}".`);
  return {
    version: 1,
    repo: stored.repo,
    profile: normalizedProfile,
    savedAt: profileManifest.savedAt,
    files: profileManifest.files,
  };
}

function emptyStoredManifest(repo: string): StoredEnvironmentManifest {
  return {
    version: 2,
    repo,
    updatedAt: new Date(0).toISOString(),
    profiles: {},
  };
}

async function listStoredManifests(paths: Paths): Promise<StoredEnvironmentManifest[]> {
  const root = environmentManifestRoot(paths);
  const manifests: StoredEnvironmentManifest[] = [];
  let owners;
  try {
    owners = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  for (const owner of owners) {
    if (!owner.isDirectory()) continue;
    const ownerRoot = path.join(root, owner.name);
    const entries = await fs.readdir(ownerRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const stored = await readStoredManifestFile(path.join(ownerRoot, entry.name));
      if (stored) manifests.push(stored);
    }
  }

  return manifests;
}

async function readStoredManifest(
  paths: Paths,
  repo: string,
  opts: { allowMissing?: boolean } = {},
): Promise<StoredEnvironmentManifest | null> {
  const manifestPath = environmentManifestPath(paths, validateRepo(repo));
  const stored = await readStoredManifestFile(manifestPath);
  if (!stored && opts.allowMissing) return null;
  if (!stored) throw new Error(`No saved environments for ${repo}.`);
  return stored;
}

async function readStoredManifestFile(manifestPath: string): Promise<StoredEnvironmentManifest | null> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const parsed = JSON.parse(raw) as Partial<StoredEnvironmentManifest>;
  if (parsed.version !== 2) throw new Error(`Unsupported environment manifest version in ${manifestPath}.`);
  if (!parsed.repo || !parsed.profiles || typeof parsed.profiles !== "object") {
    throw new Error(`Invalid environment manifest: ${manifestPath}`);
  }

  const profiles: Record<string, StoredEnvironmentProfile> = {};
  for (const [profile, profileManifest] of Object.entries(parsed.profiles)) {
    profiles[validateProfile(profile)] = {
      savedAt: profileManifest.savedAt,
      files: profileManifest.files.map(normalizeManifestEntry).sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  return {
    version: 2,
    repo: validateRepo(parsed.repo),
    updatedAt: parsed.updatedAt ?? "",
    profiles,
  };
}

async function writeStoredManifest(paths: Paths, manifest: StoredEnvironmentManifest): Promise<void> {
  const manifestPath = environmentManifestPath(paths, manifest.repo);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await fs.chmod(manifestPath, 0o600);
}

function environmentRepoPath(paths: Paths, repo: string): string {
  const [owner, name] = splitFullName(validateRepo(repo));
  return path.join(paths.environments, owner, name);
}

function environmentManifestRoot(paths: Paths): string {
  return path.join(paths.environments, ".strappy");
}

function environmentManifestPath(paths: Paths, repo: string): string {
  const [owner, name] = splitFullName(validateRepo(repo));
  return path.join(environmentManifestRoot(paths), owner, `${name}.json`);
}

function normalizeManifestEntry(entry: Partial<EnvironmentFileEntry>): EnvironmentFileEntry {
  if (!entry.path || !entry.mode || !entry.sha256 || typeof entry.size !== "number") {
    throw new Error("Invalid environment manifest file entry.");
  }
  return {
    path: validateRelativePath(entry.path),
    mode: formatMode(parseMode(entry.mode)),
    size: entry.size,
    sha256: entry.sha256,
    savedAt: entry.savedAt ?? "",
    sourceCheckout: entry.sourceCheckout ?? null,
  };
}

async function checkedSourceFile(source: string, rel: string): Promise<{ mode: number; size: number }> {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to save symlink environment file: ${rel}`);
  if (!stat.isFile()) throw new Error(`Environment path is not a file: ${rel}`);
  return { mode: stat.mode, size: stat.size };
}

async function checkedStoredFile(source: string, rel: string): Promise<{ size: number }> {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Stored environment file is a symlink: ${rel}`);
  if (!stat.isFile()) throw new Error(`Stored environment path is not a file: ${rel}`);
  return { size: stat.size };
}

async function existingTarget(target: string): Promise<Stats | null> {
  try {
    return await fs.lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function uniqueNormalizedPaths(paths: string[]): string[] {
  return [...new Set(paths.map(validateRelativePath))].sort();
}

function validateRepo(repo: string): string {
  const trimmed = repo.trim();
  splitFullName(trimmed);
  return trimmed;
}

function validateProfile(profile: string): string {
  const trimmed = profile.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`Invalid environment profile "${profile}" (use letters, numbers, dot, underscore, or dash).`);
  }
  return trimmed;
}

function validateRelativePath(input: string): string {
  const rel = input.trim().replaceAll("\\", "/");
  if (!rel || rel === ".") throw new Error("Environment file path cannot be empty.");
  if (path.posix.isAbsolute(rel)) throw new Error(`Environment file path must be repo-relative: ${input}`);
  const normalized = path.posix.normalize(rel);
  const parts = normalized.split("/");
  if (normalized.startsWith("../") || parts.includes("..")) {
    throw new Error(`Environment file path cannot escape the repo: ${input}`);
  }
  if (parts[0] === ".git" || parts.includes(".git")) {
    throw new Error(`Environment file path cannot target .git: ${input}`);
  }
  return normalized;
}

function safeJoin(root: string, rel: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, validateRelativePath(rel));
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path escapes root: ${rel}`);
  }
  return target;
}

function restoreModeFromSource(mode: number): number {
  return mode & 0o111 ? 0o700 : 0o600;
}

function formatMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

function parseMode(mode: string): number {
  if (!/^[0-7]{3,4}$/.test(mode)) throw new Error(`Invalid environment file mode "${mode}".`);
  return Number.parseInt(mode, 8) & 0o777;
}

async function hashFile(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}
