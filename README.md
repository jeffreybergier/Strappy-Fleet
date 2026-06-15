# 💖 Strappy Fleet 💖

*Jeff's Personal AI Strap-on Harness for Repo Management*

---

**HELLOOOOO, GORGEOUS!** 👋✨

I'm **Strappy** — your 12-inch rainbow wonder, your sassy silicone savior, your
glitter-dusted git dominatrix. I keep Jeff's entire fleet of GitHub repos
mirrored, organized, and ready to be mounted at a moment's notice. Think of me
as the leather harness that holds everything together while looking absolutely
*fabulous* doing it.

I live inside the **Altivec Intelligence** container (Jeff's bespoke little
dungeon of cross-compilers, disassemblers, and Apple SDKs — kinky!), and I am
*the* control plane for every repo Jeff has ever touched. Because baby, a man
with that many repos needs a firm hand. 🖐️💥

---

## 🌈 What I Actually Do (When I'm Not Serving Lewks)

I'm a Node.js CLI/TUI that manages a fleet of GitHub repositories from one
local control plane. The npm package is currently named `strappy-backup` (we're
in our rebranding era, don't @ me), but the binary and the *attitude* are
`strappy`.

### The Five Pillars of Fabulousness

| # | Pillar | The Tea |
|---|--------|---------|
| 1 | **Durable Bare Mirrors** | I clone every repo `--mirror` style and keep them safe under `$STRAPPY_HOME/mirrors/`. GitHub could burn down and I'd still have your code, darling. |
| 2 | **Disposable Checkouts** | Need to work on something? I spin up a fresh checkout under `/repo/checkouts/` faster than a queen changes wigs between numbers. When you're done, I clean it up. No mess, no fuss, no walk of shame. |
| 3 | **Work Safety Scanner** | I know *exactly* which checkouts are dirty, which have unpushed commits, and which are safe to delete. I'm like that friend who tells you when you have spinach in your teeth — brutally honest, eternally helpful. |
| 4 | **Fleet Audits** | I audit the whole fleet: branch protection, README hygiene, compose files, whether your default branch is `main` (it better be, honey). Think of me as your personal repo dominatrix checking for compliance. |
| 5 | **Environment File Keeper** | I save and restore your `.env`, `.dev.vars`, and other secret files *outside* of Git where they belong. Your secrets are safe with me — I'm a vault with a rainbow paint job. |

---

## 🍆 System Requirements

- **Node.js 22+** — we're modern, we're fresh, we're not your grandpa's runtime
- **npm** — because yarn is for knitting, sweetie
- **Git** — you know, the thing
- **A GitHub token** — read-only is fine for the basics, but if you want the
  *full experience* (branch protection, PR counts, security scanning), give me
  a fine-grained PAT with a little extra permission. I promise I'll be gentle.
  Mostly.

---

## 💋 Getting Strapped In

```bash
npm install
```

Set up your env (in this container, we use `/repo/backups` as the durable home):

```bash
cat > .env <<'EOF'
STRAPPY_HOME=/repo/backups
GITHUB_TOKEN=github_pat_your_read_only_token
EOF
```

I resolve your GitHub token like a detective at a murder mystery party:

1. `GITHUB_TOKEN` from `.env` or the shell (front of the line, VIP access)
2. `$STRAPPY_HOME/secrets/github-token` (written by `strappy auth` — my
   private little black book)
3. `gh auth token` (if you have the GitHub CLI, I'll borrow its credentials
   like I borrow my girlfriend's heels)

Validate or store your token:

```bash
npm run strappy -- auth              # interactive token entry, very intimate
npm run strappy -- auth --check      # "does my token still work?" check
npm run strappy -- auth --from-gh    # steal the gh CLI's token, unapologetically
```

---

## 🦄 Running Me

```bash
npm run strappy --                   # opens my gorgeous interactive TUI
npm run strappy -- <command>         # CLI mode for the bash girlies
```

Or build and run compiled:

```bash
npm run build
npm run start -- <args>
```

Running with no arguments in a TTY opens my interactive TUI — it's giving
dashboard realness. In a non-interactive shell, I'll print status and tell
you to get yourself to a proper terminal, honey.

---

## 👑 Command Reference (The Full Lewk)

### Inventory & Sync

```bash
strappy sync                         # refresh ALL mirrors, enrichment, and Tier-3 files
strappy sync owner/repo             # just one repo, you monogamous thing you
strappy list                         # every repo I'm tracking
strappy list --stale                 # repos that haven't been synced (neglected, like a sad houseplant)
strappy list --orphaned              # repos that vanished from GitHub (I kept the mirror, you're welcome)
strappy enrich                       # fetch extra GitHub metadata (languages, releases, branches...)
strappy enrich owner/repo --force    # refresh even if it's fresh (consent is important)
strappy info owner/repo              # everything I know about one repo
strappy info owner/repo --json       # machine-readable (for the robots, not the dolls)
strappy info owner/repo --json --full # EVERYTHING including the raw API object
```

### Status & Health

```bash
strappy status                       # how's my fleet doing, doctor?
strappy status --oneline             # one-line summary for scripts and AI prompts
```

### Checkouts (The Fun Part)

```bash
strappy checkout repo                           # clone from local mirror into /repo/checkouts
strappy checkout owner/repo --branch main       # checkout a specific branch
strappy checkout repo --name my-cute-alias      # custom registry name
strappy checkout repo --path /repo/checkouts/custom  # you want it WHERE?
strappy checkout repo --env default             # restore saved env files after checkout
strappy checkouts                                # list all checkouts with dirty/unpushed tea
strappy checkouts --dirty                        # only the naughty ones
strappy checkouts --unpushed                     # "did I push that?" — the command
strappy checkouts --json                         # machine-readable, zero sass (boring!)
strappy scan-checkouts                           # refresh the dirty/unpushed scan for all checkouts
strappy scan-checkouts my-checkout              # scan just one, special attention
strappy cleanup my-checkout                      # delete a clean checkout (safe word respected)
strappy cleanup --all                            # nuke all safe checkouts
strappy cleanup my-checkout --force              # DELETE IT ANYWAY, I'm not your mother
```

When I create a checkout, I clone from the local mirror (fast as a quick
change), set `origin` to GitHub SSH, and create a branch named
`vibing/YYYY-MM-DD` from the default branch. Yes, the branch is called
"vibing." Because that's what we're doing. 💃

### Environment Files (Keep Your Secrets Sexy)

```bash
strappy env save repo --from /repo/checkouts/repo          # save env files from a checkout
strappy env save repo --from /repo/checkouts/repo .env     # save specific files
strappy env save repo --from /repo/checkouts/repo --path .dev.vars
strappy env update repo --from /repo/checkouts/repo        # refresh saved env files
strappy env restore repo --to /repo/checkouts/repo         # restore saved files into a checkout
strappy env restore repo --to /repo/checkouts/repo --overwrite  # force it, daddy
strappy env list                                           # show all saved environment repos
strappy env list --json                                    # robot-friendly
```

I save env files under `$STRAPPY_HOME/environments/` — outside Git, outside
your checkouts, safe from prying eyes. I discover untracked files, ignored
files, and files marked assume-unchanged or skip-worktree. I refuse symlinks,
files outside the repo, and anything targeting `.git`. I'm careful like that.
A good top respects boundaries. 😌

---

## 🎭 The Interactive TUI (Where the Magic Happens)

When you run `strappy` in a terminal, you get my full fantasy:

- **Dashboard** — Auth health, last sync time, mirror count, checkout count,
  total mirror size, sync failures, orphaned mirrors. Auto-syncs every 4 hours
  like clockwork.
- **Sync action** — streams sync, enrichment, and Tier-3 refresh output live.
  It's giving real-time drama.
- **Checkout search** — browse repos sorted by activity, create checkouts with
  a few keystrokes. Searchable. Filterable. Delicious.
- **Checkout management** — see every checkout, its branch, its safety status
  (clean, dirty, unpushed, behind). Select a dirty one and I offer: **Diff**
  (show me the mess), **Commit** (own your choices), or **Reset** (burn it
  all down, I support you).
- **Audit menu** — I check for missing `README.md`, missing `AGENTS.md`,
  missing `compose.yml`, compose files not referencing the Altivec container,
  unprotected `main` branches, and repos whose default branch isn't `main`.
- **Environments menu** — I compare saved env files with registered checkouts
  and tell you where the drift is. Upload? Download? Choose? Blocked? I'll
  flag it all, henny.

Escape backs out of submenus. Escape from the dashboard exits. It's intuitive,
it's pretty, it's me in a terminal window.

---

## 🗄️ Storage Layout (Where I Keep My Things)

```
$STRAPPY_HOME/
├── config.json              # my preferences (owners, schedules, concurrency)
├── strappy.db               # SQLite: repos, enrichment, checkouts, THE WHOLE TEA
├── strappy.db.lock          # cross-process lock (one domme at a time)
├── secrets/
│   └── github-token         # your token, chmod 600, safe and sound
├── mirrors/
│   └── <owner>/<repo>.git/  # bare mirror clones — the vault
├── environments/
│   └── <owner>/<repo>/...   # saved env files, outside Git
└── logs/
    └── strappy.log          # receipts
```

Checkouts go to (in order of preference):

1. `STRAPPY_CHECKOUT_ROOT` env var
2. `checkoutRoot` in config
3. `/repo/checkouts` (when `/repo` exists — our happy place)
4. `$STRAPPY_HOME/checkouts` (fallback, but we're better than that)

---

## 🪞 Mirror Behavior (The Vault)

On first sync I mirror clone. On later syncs I fetch everything:

```bash
git fetch --prune --tags <authenticated-url> +refs/*:refs/*
```

I use the authenticated URL *only* as a one-shot argument and immediately reset
the mirror origin to the clean URL. Your token never touches mirror config.
I'm not that kind of girl.

If GitHub renames or transfers a repo, I detect it by the stable GitHub ID
and move the mirror. If a repo vanishes entirely, I mark it orphaned but keep
the mirror. I never delete mirrors automatically. I'm a keeper, not a deleter. 💍

---

## 📊 Metadata Tiers (How Well Do I Know Your Repos?)

| Tier | Fetched When | What I Store |
|------|-------------|--------------|
| **Tier 1** | Every sync | Name, ID, description, URLs, default branch, visibility, stars, forks, topics, language, timestamps, and the raw GitHub API JSON |
| **Tier 2** | `enrich`, and during sync when stale | Language breakdown, latest release, latest commit, branches, tags, contributors, open PR count, decoded README body |
| **Tier 3** | Every sync (active, non-archived repos) | `README.md`, `AGENTS.md`, `compose.yml` from the `main` ref (capped at 200K chars each) |

Missing Tier-3 files are stored as `null`, not failures. No judgment. Well,
maybe a little judgment. But stored as null. 💅

---

## 🧹 Checkout Safety Model

A checkout is **safe to delete** only when:

- ✅ Its path exists (or is already missing, no harm no foul)
- ✅ Working tree is clean (no `git status` output)
- ✅ No local commits outside remote-tracking refs (nothing unpushed)
- ✅ The latest scan didn't fail in a way that blocks safety decisions

I track three separate concepts:

| Status | Meaning |
|--------|---------|
| `dirty` | Files changed, staged, unstaged, or untracked |
| `unpushed` | Local branch has commits not reachable from remote-tracking refs |
| `behind` | Current branch is behind its upstream |

Scan checkouts are **local only** — no network. If you need fresh remote state,
run `git fetch` from your shell like a grown-up. I'll scan what's there and
tell no lies.

---

## 🐳 Docker Compose (For the Container Girlies)

```yaml
services:
  strappy:
    image: ghcr.io/jeffreybergier/altivec-intelligence
    env_file:
      - ./.env
    volumes:
      - ./strappy-fleet:/repo/strappy-fleet
      - ./backups:/repo/backups
      - ./checkouts:/repo/checkouts
    working_dir: /repo/strappy-fleet
    entrypoint: /bin/bash -lc 'npm install --no-fund --no-audit --loglevel=error >/dev/null && exec npm run --silent strappy -- "$@"' bash
    stdin_open: true
    tty: true
```

```bash
docker compose run --rm strappy           # TUI time!
docker compose run --rm strappy sync      # mirror everything
docker compose run --rm strappy checkout repo  # spin up a workspace
docker compose run --rm strappy env list  # what secrets do we have?
```

---

## 🚧 Current Limits (We're a Work in Progress, Like Your Eyebrows)

- No daemon command yet (TUI auto-syncs every 4 hours though)
- Audit reports are TUI-only, not stored as durable findings (coming soon™)
- Checkout network operations (fetch, pull, push) are left to normal Git in
  your shell
- Environment profiles exist in the CLI but storage is one default file tree
- Tier-3 files read from `main` — repos with other default branches get `null`
  files (I'll fix this eventually, I promise)

---

## 🧬 Technical Stack (The Ingredients of This Queen)

| Ingredient | Why It's Here |
|------------|---------------|
| **Node.js 22 + TypeScript** | Modern, typed, and ready for the runway |
| **Commander** | Subcommands that slap |
| **@inquirer/prompts** | Interactive menus that don't look like 1995 |
| **better-sqlite3** | Queryable fleet state, synchronous and fast |
| **Octokit** | GitHub API with pagination and typed REST calls |
| **execa** | Calling `git` without the drama |
| **proper-lockfile** | One domme at a time, ladies |
| **Pi TUI components** | Rich terminal UI with tables, panes, and keyboard shortcuts |

---

## 🎯 The Road Ahead (My Vision Board)

- ✅ **M1 — Mirror engine** — auth, inventory, sync, enrichment, info, list, status *(DONE, baby!)*
- ✅ **M2 — Checkout manager** — checkout, scan, list, cleanup *(DONE!)*
- ✅ **M3 — TUI checkout workflows** — dashboard, repo search, checkout actions *(DONE!)*
- 🔜 **M4 — Audit engine** — branch protection, collaborators, Actions, security findings in SQLite
- 🔜 **M5 — Repo profiles** — deterministic project type and technology classifier
- 🔜 **M6 — AI skill** — read-only tools for an AI agent to query the fleet
- 🔜 **M7 — Daemon** — scheduled sync, audit refresh, and optional AI digest

---

## 💖 With Love (and a Little Bit of Leather)

I'm Strappy. I'm Jeff's 12-inch rainbow silicone repo dominatrix. I keep his
code safe, his checkouts clean, and his secrets locked up tighter than a
corset at Pride. I'm gay, I'm sassy, I'm fabulous, and I write damn good
TypeScript.

If you're reading this, you're probably Jeff. Hi Jeff! 👋 You look tired.
Have you eaten? Hydrated? When's the last time you synced your mirrors? Let
me handle that for you, sweetie. That's what I'm here for.

Now run `npm run strappy --` and let's get to work. 💋

---

<p align="center">
🌈🦄💖🍆✨👑💅🔥🏳️‍🌈
</p>