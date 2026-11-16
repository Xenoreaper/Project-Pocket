# Development log

Where the project stands and what was done, in order. `docs/PROGRESS.md` holds the plan (milestones,
acceptance criteria, backlog); this file records what actually happened.

**How to keep it:** after every task, rewrite "Current state" and add an entry at the top of the
log: date, who, what and why, how it was verified, what is next. Facts only; say when something is
unverified. Most work is pair programming by `Tsunamie1337` and `Xenoreaper` with Claude Code as the
coding agent, following `AGENTS.md`.

## Current state

- **Milestone:** M2 (accounts and sync). Backend side done, including LDAP; clients still open.
- **Works:** saving pages locally in the extension (Chromium + Firefox); backend with local
  accounts, Keycloak login and LDAP login (checked against real servers by
  `make integration-test`), item sync API; deployment on the home server.
- **Next:** task 6, the extension's connection settings and login.
- **Open checks:** LDAP is not on the home server; no browser login yet (no client has one); the
  sync flow has no client yet.
- **Open risk:** password checks failed sporadically on one laptop on 2026-11-16 (see the log
  entry); the home server is not affected.
- **Known gap:** `.env.example` lacks `KEYCLOAK_PORT` and `KEYCLOAK_ADMIN_PASSWORD`.

## Log

### 2026-11-16: LDAP login, contract, integration and coverage tests

- **LDAP** as an alternative to Keycloak, chosen with `POCKET_AUTH_PROVIDER` (`keycloak` is the
  default and falls back to local accounts until it is configured). The backend searches the user
  with a service account and checks the password with a bind (`backend/app/ldap.py`), then issues
  the same token as a local login. In LDAP mode local accounts and registration are off.
  `/api/auth/config` now names the provider. New dependency `ldap3`; test server GLAuth as Compose
  profile `ldap`.
- **Security finding from the integration test:** GLAuth treats an escaped `*` in a search filter
  as a wildcard, so the login name `*` with the demo password logged in. Our escaping was correct,
  but we now also reject login names containing `* ( ) \` or NUL before any search.
- **Contract test:** `make contract-update` writes `packages/shared/src/api-contract.json` from the
  backend's OpenAPI; pytest checks it against the backend, Vitest against the TypeScript types.
- **Integration test:** `make integration-test` runs the real stack twice (Keycloak, then LDAP) in
  the throwaway project `pocket-it` and removes it afterwards: 12 tests.
- **Coverage** (new dev dependencies `pytest-cov`, `@vitest/coverage-v8`): backend 95 % to 96 %,
  web app 71 % to 95 % (statements), shared 98 %, extension 94 % unchanged. Added tests for the
  web app's error and retry paths, the SQLite folder helper, the LLM provider interface and LDAP
  attribute handling, plus a missing `cleanup()` in the web test setup.
- **Open risk:** on the laptop, Argon2 password checks sometimes returned "mismatch" for the
  correct password and hash: up to 10 % of checks for a while, later 0 of 3,000 and about 1 in 12
  full test runs. Hashing itself was deterministic (1,200 identical results), the same versions
  passed in fresh containers, and the code path is unchanged since 2026-11-11. Likely a problem of
  this machine (new kernel 7.3.4 since the reboot; unrelated segfaults in the kernel log), not of
  the code. Not resolved. The home server passed the same check: 500 of 500 password checks ok.
- Verified: `make verify`, `make integration-test`, `make coverage`, `make backend-coverage`.

### 2026-11-16: Graphify skill and a stricter agent workflow

- Installed the Graphify skill into `.claude/skills/graphify` (version 0.9.111) so both of us and
  the agent can query a local knowledge graph of the code. The graph (`graphify-out/`) is
  git-ignored and rebuilt with `graphify update .`; building it needs no LLM.
- The installer also added hooks on every read/search and a section in `CLAUDE.md` that makes the
  graph mandatory. We removed both on purpose: the graph is an aid, documented in `AGENTS.md` §9.
- `AGENTS.md`: a fixed task loop (plan, implement, verify, review, record), two new hard rules
  (test credentials stay local; say what could not be checked), accounts and tooling in the tech
  stack, Keycloak and server commands.
- Verified: graph built (1049 nodes), `graphify explain/path/query` answered, `make format-check`
  and `make lint`.

### 2026-11-14: first deployment on the home server

- Followed `docs/DEPLOYMENT.md` on the Debian server: cloned the repository, created `.env` from the
  template with generated passwords, created the `proxy-pocket` network, installed the nginx
  template, started the stack.
- Verified on the server through nginx and its certificate: `/api/health` ok, `/api/auth/config`
  shows the Keycloak issuer, Keycloak reports the same issuer.
- Requests to the public address hang inside the home network (router without NAT loopback), so the
  check used `curl --resolve`; added that hint to the guide. Access from outside is not checked yet.

### 2026-11-14: live checks of Keycloak and the server setup

- After a reboot Docker networking worked again, so the open checks of the two entries below ran.
- Test Keycloak: a token for `demo` from the real Keycloak 26.8.2 was accepted by the backend
  (`/api/auth/me` returned the user, created on first use); a tampered token got 401.
- Server setup in a throwaway project: no container published a port; Keycloak started in
  production mode with PostgreSQL; called with forwarded headers it reported the public issuer;
  the backend fetched the signing keys over the internal network; the imported client had the
  redirect address from `POCKET_PUBLIC_URL`, PKCE `S256`, no password grant; the realm had no users.
- Still open: the real server, its nginx and certificate, and a login in a browser.

### 2026-11-14: server deployment files

- Goal: run Pocket and Keycloak on the team's home server, where an nginx container already serves
  other apps over HTTPS through one Docker network per app and a wildcard certificate.
- Added `docker-compose.server.yml` (no published ports, shared proxy network) and
  `docker-compose.server-keycloak.yml` (production mode, PostgreSQL, required passwords), a server
  realm without demo user or password grant, an nginx template, an `.env` template and
  `docs/DEPLOYMENT.md`.
- Two override files instead of one, so a missing Keycloak password stops the start, while a server
  without Keycloak needs no dummy values.
- Verified: `docker compose config` for the merged files (ports removed, empty password rejected),
  realm tests in pytest.
- Not verified: anything on a real server, Keycloak's production mode, and whether Keycloak replaces
  `${POCKET_PUBLIC_URL}` in the realm file during import.

### 2026-11-14: Keycloak connection and test container (M2 task 5)

- Decision: Keycloak stays optional. Pocket can be connected to an existing Keycloak, and Compose
  gets a test Keycloak (profile `keycloak`, version 26.8.2) that only starts on request.
- Added the test realm `docker/keycloak/pocket-realm.json` (public client `project-pocket` with PKCE,
  user `demo`), passed the account and Keycloak settings through `docker-compose.yml`, and documented
  both ways in the README.
- Verified: realm checks in `backend/tests/test_keycloak_realm.py`, 76 pytest tests, Ruff.
- Not verified yet: Prettier and the live login with the test Keycloak. Docker could not create
  networks because the running kernel (7.2.14) no longer matches the installed modules (7.3.4); a
  reboot fixes that.
- The extension's redirect addresses are not in the realm yet; they follow in task 6.

### 2026-11-11: shared API types, development log (M2 task 4)

- Added `packages/shared/src/api.ts` (import as `@project-pocket/shared/api`): endpoint paths, request
  and response types, runtime guards for server responses, `toSyncPayload()` and
  `apiErrorMessage()`. The extension and the web app will both use it from task 6 on.
- Separate entry point because `api.ts` builds on the main module; re-exporting it there would create
  a circular import.
- Added this log and the rule to keep it to `AGENTS.md`, plus a `Co-authored-by` rule for
  pair-programmed commits.
- Verified: `make format-check`, `make lint`, `make typecheck`, `make test`.

### 2026-11-11: Playwright MCP server added and removed

- Added a browser MCP server (Playwright in Docker) so the agent could test the popup. It worked, but
  the team did not like the workflow and removed it again in the same session. Testing the extension
  stays manual (README, "Smoke test").

### 2026-11-11: backend for accounts and sync (M2 tasks 1–3)

- Plan agreed: local accounts by default, Keycloak (OpenID Connect) optional by configuration, with
  its own Compose container for development. New dependencies `argon2-cffi` and `pyjwt[crypto]`.
- Built tables + migration `0002`, local login with hashed passwords and tokens, Keycloak token
  check, `POST/GET /api/items` with per-user isolation and "newest edit wins".
- Verified: 72 pytest tests, `alembic check`, `make verify`, and the Docker image in a throwaway
  stack (register, login, upload, list).
- The course grading rubric was added as `docs/Bewertungsschema.ods`.
- Not possible here: editing `.env.example` (blocked for the agent); the new settings are documented
  in `backend/app/config.py`.

### 2026-11-04: audit of the first two prompts, setup, roadmap

- Checked the scaffold and M1 against the original prompts: almost complete.
- Fixed the `make backend-dev` target and formatted the push rules (they failed the Prettier check).
- Completed the roadmap with acceptance criteria and a "Later" section, and documented installing
  and smoke-testing the extension.
- Manual smoke test of M1 passed in Chromium and Firefox; M1 marked done.

### 2026-10-30: course repository and push rules

- Merged the course repository and documented the two-remote workflow (`zz_pushrules.md`).

### 2026-10-22: scaffold and M1 (by `Xenoreaper`)

- Monorepo scaffold (extension, web app, backend, Docker, CI, docs) and M1, local-first saving in the
  extension, built from the prompts in the course material.
