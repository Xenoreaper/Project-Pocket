# zz_pushrules.md — How we push from now on

Cheat sheet for the team. This repository lives in **two** GitHub repos and both must stay identical.

| Remote   | URL                                                          | Role                                        |
|----------|--------------------------------------------------------------|---------------------------------------------|
| `hse`    | https://github.com/hse-classes/llm-ws26-bananenkrieger.git   | Course repo — **default upstream** of `main` |
| `origin` | https://github.com/Xenoreaper/Project-Pocket.git             | Our own repo — mirror                       |

`main` tracks `hse/main`, so a plain `git push` / `git pull` talks to `hse`.
`origin` must always be pushed **explicitly**.

---

## Golden rules

1. **Never force-push.** `hse` forbids it on `main` (rule GH013), and it would break the mirror anyway.
   No `git push --force`, no rewriting history that is already pushed (`rebase`, `commit --amend`, `reset`).
2. **Always pull before you push** — from both remotes.
3. **Always push to both remotes.** First `hse`, then `origin`.
4. **Small, focused commits** with Conventional Commit messages (see `AGENTS.md` §7).
5. **Run `make verify` before pushing.** No red tests on `main`.
6. AI agents never commit or push (see `AGENTS.md` §3) — that is always done by us.

---

## Daily workflow

```bash
# 1. Get the latest state from both repos
git pull                      # = git pull hse main
git pull origin main          # catches anything pushed only to origin

# 2. Work … then check what changed
git status                    # which files are modified / new
git diff                      # unstaged changes in detail

# 3. Stage
git add path/to/file          # stage a single file (preferred)
git add -p                    # pick changes hunk by hunk
git add .                     # stage everything in the current folder (check git status first!)
git diff --staged             # review exactly what will be committed

# 4. Commit (Conventional Commits)
git commit -m "feat(extension): add context menu for saving pages"

# 5. Check quality
make verify

# 6. Push to BOTH remotes
git push                      # = git push hse main
git push origin main
```

Commit types: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`.
Scopes: `extension`, `web`, `backend`, `shared`, `docs`, `ci`, `docker`.

---

## Fixing mistakes

```bash
git restore --staged path/to/file   # unstage a file (changes stay in the working tree)
git restore path/to/file            # throw away local changes to a file (cannot be undone!)
git commit --amend                  # fix the last commit — ONLY if it is NOT pushed yet
git reset --soft HEAD~1             # undo the last commit, keep changes staged — ONLY if NOT pushed yet
git revert <commit-hash>            # undo an ALREADY pushed commit with a new commit (safe)
```

### Push rejected ("fetch first" / "non-fast-forward")

Someone pushed before you. Do **not** force — merge instead:

```bash
git pull --no-rebase          # or: git pull origin main --no-rebase
# resolve conflicts if any, then:
git add <resolved files>
git commit
git push
git push origin main
```

### Remotes got out of sync

```bash
git fetch --all
git log --oneline -1 hse/main
git log --oneline -1 origin/main    # both must show the same hash
```

If one is behind: `git pull <remote> main --no-rebase`, then push to both again.

---

## Setting up a fresh clone (e.g. in WSL)

```bash
git clone https://github.com/hse-classes/llm-ws26-bananenkrieger.git Project-Pocket
cd Project-Pocket
git remote add origin-mirror https://github.com/Xenoreaper/Project-Pocket.git
```

> Note: in a fresh clone from `hse`, the course repo is called `origin` and our repo
> `origin-mirror`. To keep the names from this file instead:
>
> ```bash
> git remote rename origin hse
> git remote rename origin-mirror origin
> git branch -u hse/main
> ```
