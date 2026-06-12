# Strappy - Dynamic Repo Manager

Strappy is a Node.js CLI/TUI for managing a fleet of GitHub repositories as if
they were one dynamic monorepo. It has five jobs:

1. Keep durable bare mirrors of every repo.
2. Create disposable working copies under `/repo/checkouts/`.
3. Show which checkouts contain local work, unpushed commits, or pending relay
   pushes.
4. Audit GitHub repo configuration across the fleet.
5. Let an AI agent, via Pi, answer questions about the repos using local
   mirrors and normalized metadata.

The backup remains the foundation, but the product should feel less like a
backup script and more like a local control plane for all repos.

---

## 1. Core Ideas

1. **The mirror store is the local source of truth.** Every GitHub repo is
   mirrored with `git clone --mirror` into `$STRAPPY_HOME/mirrors/`. Mirrors
   hold all refs and survive remote deletion, transfer, or lost access.

2. **Checkouts are temporary workspaces.** `strappy checkout <repo>` clones from
   the local mirror into `/repo/checkouts/<name>` by default. Checkouts can be
   removed freely once Strappy proves they have no unsaved or unpushed work.

3. **Work safety is visible everywhere.** The tool continuously answers:
   "Which checkouts are dirty?", "Which branches are ahead of the mirror?",
   "Which mirror refs still need to be pushed to GitHub?", and "What can I
   safely delete?"

4. **GitHub posture is an auditable dataset.** Branch protection, collaborators,
   Actions, Dependabot/security features, README/license hygiene, archival
   state, and stale activity become structured findings, not one-off command
   output.

5. **AI reads through Strappy tools.** Pi integration should use read-mostly
   tools backed by mirrors, SQLite, and GitHub metadata. Secrets stay in
   `$STRAPPY_HOME/secrets`; the model does not get raw tokens or uncontrolled
   filesystem access.

6. **One binary, two modes.** `strappy` opens the interactive TUI by default.
   `strappy daemon` performs scheduled syncs, audits, and optional digests.
   Both coordinate through SQLite plus a lock file.

---

## 2. On-Disk Layout

```
$STRAPPY_HOME/                         # default ~/.strappy, env-overridable
├── config.json                        # owners, schedules, checkout root, audit prefs
├── strappy.db                         # repos, enrichment, checkouts, findings
├── strappy.db.lock                    # cross-process lock for sync/audit writes
├── secrets/
│   ├── github-token                   # fine-grained PAT, chmod 600
│   └── pi-token                       # optional provider/API secret
├── mirrors/
│   └── <owner>/<repo>.git/            # bare mirror clones
└── logs/
    └── strappy.log

/repo/checkouts/                        # default checkout root in this workspace
└── <name>/                            # disposable working copy
```

`/repo/checkouts` should be the default checkout root for this environment. Make
it configurable as `checkoutRoot` in `config.json` and overridable with
`STRAPPY_CHECKOUT_ROOT`; outside this container/workspace the fallback can be
`$STRAPPY_HOME/checkouts`.

Current implementation note: the app already uses SQLite (`strappy.db`) for
repo inventory, enrichment, and checkout registry. The old `state.json` shape
in earlier plans should be treated as historical.

### Key Tables

The current `repos` and `enrichment` tables are the base. Add or extend:

| Table | Purpose |
| --- | --- |
| `checkouts` | Registered working copies, path, branch, mode, last scan, dirty/ahead flags. |
| `checkout_branches` | Per-branch status: local head, upstream head, ahead/behind, pending relay. |
| `audit_findings` | Repo findings with category, severity, evidence, remediation, timestamps. |
| `repo_profiles` | Deterministic technology classification and project type. |
| `agent_notes` | Optional Pi summaries/digests generated from Strappy tools. |

---

## 3. Goal 1 - Complete Backup

This is mostly implemented.

### Inventory

- Enumerate owned repos with Octokit: `GET /user/repos?affiliation=owner`.
- Include configured owners/orgs from `config.json`.
- Detect renames/transfers by stable GitHub repo id.
- Keep orphaned mirrors forever unless explicitly forgotten.
- Store tier-1 repo metadata from the list response and raw GitHub API JSON.

### Sync

```
if mirrors/<owner>/<repo>.git missing:
    git clone --mirror <authenticated-url> mirrors/<owner>/<repo>.git
else:
    git fetch --prune --tags <authenticated-url> +refs/*:refs/*
record result + timestamp in SQLite
```

Rules:

- Never store authenticated URLs in git config.
- Never delete mirrors automatically.
- Guard sync runs with `proper-lockfile`.
- Treat a mirror as the durable backup; point-in-time backup of `$STRAPPY_HOME`
  itself is still handled by Time Machine/restic/ZFS/etc.

---

## 4. Goal 2 - Checkout Manager

This should be the next major product step because it turns Strappy from
"backup" into a daily repo manager.

### Commands

```
strappy checkout <repo> [--branch B] [--name NAME] [--path PATH] [--direct]
strappy checkouts [--dirty|--unpushed|--json]
strappy scan-checkouts [name|--all]
strappy push <name-or-repo> [branch]
strappy cleanup [name|--all|--older-than AGE] [--force]
strappy open <name-or-repo>             # print path, or optionally launch $EDITOR
```

Default checkout path:

- If repo names are unique: `/repo/checkouts/<repo>`.
- If two repos share a name: `/repo/checkouts/<owner>--<repo>`.
- `--name` lets the user choose a shorter alias.

### Checkout Flow

1. Resolve repo by `owner/name`, bare `name`, or fuzzy search in the TUI.
2. Ensure the mirror exists and is fresh enough, fetching if online.
3. Clone from the local mirror into the checkout root.
4. Set `origin` to the local mirror by default.
5. Register the checkout in SQLite.
6. Run the first checkout scan immediately.

`--direct` remains an escape hatch that sets `origin` to GitHub and relies on
ambient credentials. The default should stay local-mirror origin.

### Status Model

A checkout is safe to delete only when all of these are false:

- dirty working tree: `git status --porcelain=v1` has output
- local commits not pushed to the mirror: `git log --branches --not --remotes`
  has output
- mirror refs created by this checkout have not been relayed to GitHub

Track three separate concepts in the UI:

| Status | Meaning |
| --- | --- |
| `dirty` | Files changed, staged, unstaged, or untracked in the checkout. |
| `ahead of mirror` | Local branch commits exist only in the checkout. |
| `pending GitHub push` | Commits reached the mirror but are not confirmed on GitHub. |

That distinction matters because a user may run `git push origin my-branch`,
which pushes to the local mirror, but still needs `strappy push` to relay that
branch to GitHub.

### Relay Push

Default flow:

```
git push origin my-branch                 # checkout -> local mirror
strappy push widget my-branch             # local mirror -> GitHub
```

Implementation:

- Add a clean `github` remote in the mirror, or push to an authenticated URL
  without writing the token to config.
- Push only the named ref, never `--mirror`.
- Record relay attempts and outcomes.
- After relay, fetch/sync the mirror and mark the ref confirmed only when the
  commit is visible from GitHub.

### Cleanup

`strappy cleanup` refuses unless the checkout is clean. `--force` should still
show a final confirmation in the TUI when dirty or unpushed work exists.

Useful cleanup actions:

- Clean one checkout.
- Clean all safe checkouts.
- Clean safe checkouts older than N days.
- Mark missing checkout paths as gone.
- Re-scan before deletion so the decision is current.

---

## 5. Goal 3 - GitHub Fleet Audits

Audits should create durable findings, not just print text. This makes them
queryable by the TUI and by Pi.

### Command Surface

```
strappy audit [repo...] [--category C] [--force]
strappy findings [--severity warn|danger] [--category C] [--json]
strappy dismiss <finding-id> [--until DATE] [--reason TEXT]
```

### Audit Categories

| Category | Checks |
| --- | --- |
| Branch protection | Default branch protected, required PR reviews, required status checks, force-push/deletion settings, admin bypasses. |
| Access | Direct collaborators, outside collaborators, teams, permission levels, stale invites. |
| Actions/CI | `.github/workflows` exists, workflows enabled, recent run status, required checks mapped to branch protection. |
| Security | Dependabot alerts/settings, secret scanning, code scanning, vulnerability alerts where API scopes allow. |
| Hygiene | README, license, topics, stale repos, archived/fork/template flags, releases/tags, default branch name. |

### Finding Shape

```jsonc
{
  "id": "repo:owner/name:branch-protection:main-unprotected",
  "repo": "owner/name",
  "category": "branch-protection",
  "severity": "danger",
  "title": "Default branch is not protected",
  "evidence": { "defaultBranch": "main", "protected": false },
  "remediation": "Enable branch protection for main and require PR review.",
  "detectedAt": "2026-06-12T00:00:00Z",
  "resolvedAt": null,
  "dismissedUntil": null
}
```

### Token Scopes

Keep the backup token minimal. Audit mode may require additional fine-grained
PAT permissions, depending on private repos and endpoints:

- metadata/read for inventory
- contents/read for mirrors and workflow file inspection
- actions/read for workflow/runs
- administration/read for branch protection and collaborators
- security-events/read or Dependabot-related scopes for security findings

The TUI should show "scope missing" as a neutral audit state, not as a repo
failure.

---

## 6. Goal 4 - Repo Profiles and Pi Ask

Before asking an LLM, Strappy should build deterministic repo profiles from
mirrors. This gives Pi compact, reliable context and avoids spending model
tokens on obvious detection.

### Deterministic Profile

Inspect files at the default branch in the mirror:

| Signal | Inference |
| --- | --- |
| `package.json`, `vite.config.*`, `next.config.*`, `astro.config.*` | web app or frontend package |
| `package.json` with `bin`, `commander`, `tsx` | Node CLI/tool |
| `Package.swift`, `*.xcodeproj`, `*.xcworkspace` | Swift/macOS/iOS project |
| `Cargo.toml` | Rust crate or app |
| `go.mod` | Go module |
| `pyproject.toml`, `requirements.txt`, `uv.lock` | Python project |
| `Dockerfile`, `compose.yaml`, `.github/workflows/*` | deploy/infra/CI signals |
| README headings/topics/languages | project purpose hints |

Store:

- `projectType`: `web`, `mac`, `ios`, `cli`, `library`, `infra`, `agent`,
  `data`, `unknown`
- `languages`: normalized language percentages
- `frameworks`: React, Next, Vite, SwiftUI, FastAPI, etc.
- `packageManagers`: npm, pnpm, bun, uv, cargo, go
- `entrypoints`: scripts, binaries, app targets
- `confidence` and evidence paths

### Pi Tools

Pi should get tools like:

| Tool | Backed by |
| --- | --- |
| `list_repos` | SQLite repo inventory, filters, profiles. |
| `repo_profile` | Deterministic profile + enrichment + recent activity. |
| `checkout_status` | Dirty/unpushed/pending relay state. |
| `audit_findings` | Current findings and dismissed/resolved state. |
| `git_log` | `git log` against the local mirror. |
| `list_files` | `git ls-tree` at a ref. |
| `read_file` | `git show <ref>:<path>` from the mirror. |
| `search_code` | ripgrep over a temporary checkout or indexed snapshot. |
| `run_sql_readonly` | Read-only SQLite queries with limits. |

Example questions:

- "Which repos are web apps?"
- "Which repos look like macOS projects?"
- "Which Node projects still target old Node versions?"
- "Which repos have unprotected default branches?"
- "Which checkouts have work I need to push before cleanup?"
- "Summarize repos that have been stale for more than a year."

Guardrails:

- Default Pi mode is read-only.
- No secrets are exposed through tools.
- File reads come from mirrors unless the user explicitly asks about a
  checkout.
- Expensive scans are cached in SQLite.

---

## 7. TUI Proposal

The TUI should optimize for repeated operations: scan, compare, checkout, push,
cleanup, audit, ask. Avoid a marketing-style home screen; open directly into
the fleet dashboard.

### First Screen

```
 STRAPPY  /repo/checkouts   sync 2h ago   128 repos   7 checkouts   2 dirty   5 findings
 ─────────────────────────────────────────────────────────────────────────────
  Dashboard   Repos   Checkouts   Audits   Ask   Settings

  Needs Attention
  danger  2 checkouts have local commits not in mirrors
  warn    3 default branches are unprotected
  warn    4 repos have failing or missing GitHub Actions

  Recent Checkouts
  name        repo                 branch   age    status
  widget      me/widget            main     3d     dirty, ahead of mirror
  api         org/api              feat/x   8h     pending GitHub push

  Recent Sync
  126 ok   2 failed   1 orphaned   next daemon run in 3h
```

### Navigation

Use tabs or a left rail:

| View | Purpose | Primary actions |
| --- | --- | --- |
| Dashboard | Fleet health summary. | Sync now, scan checkouts, run audit. |
| Repos | Search/browse all mirrors and metadata. | Checkout, sync one, enrich, profile, info. |
| Checkouts | Manage `/repo/checkouts`. | Open path, scan, relay push, cleanup safe, force cleanup. |
| Audits | Findings by repo/category/severity. | Refresh, dismiss, copy remediation, open GitHub URL. |
| Ask | Pi-powered repo Q&A. | Ask, save answer, jump to referenced repo. |
| Settings | Auth, owners, schedules, checkout root, scopes. | Check token, edit config, test GitHub scopes. |

### Repo List

Columns:

```
repo              type   lang       last push   mirror     audit    checkout
me/widget         web    TS 91%     2d          fresh      warn     dirty
org/mac-tool      mac    Swift      14d         fresh      ok       -
me/old-api        api    Python     3y          fresh      danger   -
```

Actions for selected repo:

- checkout
- sync now
- enrich/profile
- audit
- ask about this repo
- show details
- open GitHub

### Checkout View

Columns:

```
name       branch      dirty   ahead mirror   pending GitHub   age   path
widget     main        yes     2 commits      no               3d    /repo/checkouts/widget
api        feat/x      no      0              yes              8h    /repo/checkouts/api
```

Actions:

- rescan
- open shell/path
- push to mirror instructions if ahead of mirror
- relay push to GitHub if pending
- cleanup if safe
- force cleanup with explicit confirmation

### Audit View

Group by severity first, then category:

```
danger  me/widget       main is unprotected
warn    org/api         Actions workflow exists but latest default-branch run failed
info    me/old-tool     No release has ever been published
```

Selecting a finding shows evidence, API scope notes, remediation, GitHub URL,
and dismiss controls.

### Ask View

The Ask pane should feel like a constrained fleet analyst, not a coding agent:

```
Ask: Which repos are web apps with no GitHub Actions?

Answer
  6 likely web apps have no workflow files...

Referenced repos
  me/site      web, Vite, no .github/workflows
  org/app      web, Next, no .github/workflows
```

Useful affordances:

- slash presets: `/web`, `/mac`, `/dirty`, `/audit`, `/stale`
- references are selectable
- answers can be saved as `agent_notes`
- TUI can show tool calls in a collapsible detail pane

### Implementation Approach

Short term:

- Use `@inquirer/prompts` for searchable menus and action flows.
- Implement the default `strappy` command as a useful menu quickly.
- Keep all actions backed by normal commands so scripting stays first-class.

Richer TUI:

- Use Pi's TUI package or Ink once the workflows stabilize.
- Move to live panes/tables, incremental refresh, keyboard shortcuts, and
  collapsible detail panes.
- Keep the same command/service layer underneath.

---

## 8. CLI Surface

```
strappy                         # interactive TUI
strappy auth [--check]
strappy sync [repo...]
strappy enrich [repo...] [--force]
strappy profile [repo...] [--force]
strappy list [--stale|--orphaned|--type T]
strappy info <repo> [--json|--full]

strappy checkout <repo> [--branch B] [--name N] [--path P] [--direct]
strappy checkouts [--dirty|--unpushed|--json]
strappy scan-checkouts [name|--all]
strappy push <name-or-repo> [branch]
strappy cleanup [name|--all|--older-than AGE] [--force]

strappy audit [repo...] [--category C] [--force]
strappy findings [--severity S] [--category C] [--json]
strappy dismiss <finding-id> [--until DATE] [--reason TEXT]

strappy ask "<question>"
strappy daemon
strappy status [--oneline]
```

---

## 9. Technology Choices

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js >= 22 + TypeScript | Existing app and Pi ecosystem are TypeScript-friendly. |
| Subcommands | `commander` | Already implemented and script-friendly. |
| Prompt TUI | `@inquirer/prompts` | Already present; enough for v1 interactive flows. |
| Rich TUI | Pi TUI package or Ink | Better tables/panes once workflows are settled. |
| Git operations | `execa` calling `git` | Mirrors and refs are easiest to debug with native git. |
| GitHub API | `octokit` | Already implemented, supports pagination and typed REST calls. |
| State | `better-sqlite3` | Already implemented; good for queryable fleet state. |
| Locking | `proper-lockfile` | Already implemented for sync/enrich coordination. |
| LLM | Pi packages | Provider-agnostic agent loop and terminal UI ecosystem. |

---

## 10. Suggested Milestones

1. **M1 - Mirror engine (done):** auth, inventory, sync, enrichment, info,
   list, status, SQLite store.
2. **M2 - Checkout manager:** checkout into `/repo/checkouts`, scan dirty/ahead
   state, list checkouts, cleanup safe checkouts.
3. **M3 - Relay push:** local mirror origin flow, explicit `strappy push`,
   pending GitHub push tracking.
4. **M4 - TUI v1:** dashboard, repo search, checkout actions, sync/enrich
   actions using `@inquirer/prompts`.
5. **M5 - Audit engine:** branch protection, collaborators, Actions, security,
   hygiene findings stored in SQLite.
6. **M6 - Repo profiles:** deterministic project type/technology classifier.
7. **M7 - Pi Ask:** read-only tools over inventory, profiles, mirrors,
   checkouts, and audit findings.
8. **M8 - Daemon:** scheduled sync, audit refresh, checkout scans, optional AI
   digest.

This ordering prioritizes daily usefulness: backup already works, so the next
valuable thing is knowing what is checked out and whether it is safe to clean.

---

## 11. Open Questions

- Should `/repo/checkouts` always be the default in this repo, or only when that
  path exists?
- Should the default checkout remote be local mirror only, or should Strappy add
  a read-only `github` remote for comparison while keeping credentials out of
  checkout config?
- For relay push, should users explicitly run `strappy push`, or should the
  daemon auto-relay branches matching `refs/strappy/outbox/*`?
- How aggressive should cleanup be: only manual, or "delete all safe checkouts
  older than N days" from the TUI?
- Are you comfortable granting the audit token administration/read and
  actions/read scopes for private repos, or should audits degrade gracefully with
  the current backup token?
- Should Pi answers be stored as durable notes/digests, or treated as ephemeral
  chat output?
