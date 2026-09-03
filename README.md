# ThankBot

An internal **appreciation board**. Teammates sign in with Google, thank each
other on the web or with Slack `/thanks`, and the team sees it on a private
feed and leaderboard.

| Layer | Choice |
|-------|--------|
| App | **Next.js 14** (App Router), TypeScript, Tailwind — deployed on **Vercel** |
| Data + auth | **Supabase** (Postgres, RLS, Google OAuth) |
| Chat | **Slack** slash command `/thanks`, in-channel announcement + card GIF |

---

## Executive summary

ThankBot records *who thanked whom, for what*, so recognition is visible and
countable instead of trapped in DMs.

- **Audience.** One company or workspace. The board is **not public**: pages
  and most APIs require a signed-in Google session. Slack `/thanks` is the
  exception (verified by Slack's signing secret).
- **Value.** One shared card per thanks (including several recipients). A
  period-filtered feed and leaderboard. Slack posts an announcement plus a
  public GIF so the moment is visible in-channel; the card page can show
  Slack emoji and thread replies when the install is complete.
- **Cost of ownership.** The app is a single Next.js project. Production
  depends on three consoles **outside this repo**: a hosted Supabase project,
  a Google OAuth client, and a Slack app. Schema migrations are **not**
  applied by CI — they must be pushed to the hosted database as part of each
  release. Slack scopes do nothing until the app is **reinstalled**.
- **Health.** `GET /api/health` needs no session. It returns `503` when a
  migration or Slack scope is behind the code. Point an uptime monitor at it.

**Current preview deployment** (redirects, slash-command URL, and
`.env.example` defaults): `https://thankbot.previewmach9.com`. The hosted
Supabase project is `qewqxlzvlpgmhwibkfig`. Replace both when standing up a
new environment.

---

## This is a migration, not a greenfield app

ThankBot shipped first as a self-contained prototype: an **SQLite** file
(`better-sqlite3`) on the app server, no accounts, and a Slack slash command
that wrote rows straight into that file. What this repository holds is the
**migrated** app. Most of the operating rules below exist because of that
move, so they are easier to follow if you read them in that light.

- **Data.** SQLite was replaced by a hosted **Supabase** Postgres project;
  `supabase/migrations/0001_init.sql` is the shape it landed in. Nothing in
  the repo reads a local database file any more, and prototype rows do not
  travel with the code. A new environment starts empty until `pnpm seed` runs
  or `people` / `thanks` are imported.
- **Identity.** The prototype had no sign-in at all. The migration added
  Google OAuth through Supabase Auth, Row Level Security on every table, and
  the login wall in `src/middleware.ts`. A teammate who exists only as a
  Slack user gets a `people` row, which their first Google login **claims**
  by email — that claim is the migration path for people, and it is why an
  email mismatch shows up as a duplicate teammate rather than an error.
- **Slack.** `/thanks` survived the move, but it now writes through the same
  Postgres tables using the service role after signature verification, rather
  than into local storage. It was re-enabled after the web flow settled, so
  Slack features arrived in layers and each one has its own scope
  requirement.
- **Schema, from here on.** The database moves forward as numbered files in
  `supabase/migrations/` (`0001` … `0006` today), applied **by hand** to the
  hosted project — CI never applies them. Because that migration sequence is
  still live, the app is deliberately written to **degrade rather than crash**
  when the database is behind the code: a thanks sent before
  `0004_group_thanks_recipients.sql` is still recorded, just as one row per
  recipient instead of one shared card. `GET /api/health` names whichever
  files are outstanding.

If you are standing up an environment, read [Setup (outside this
repository)](#setup-outside-this-repository) as the migration runbook: those
four vendor consoles hold the state that used to be one file on disk, and
none of it is recreated by cloning.

---

## Setup (outside this repository)

Do this in the vendor consoles **before** (or alongside) cloning the repo. A
new environment is not "set up" until all four of these exist: **Supabase
project**, **Google OAuth client**, **Slack app**, **Vercel project** (or
another Next.js host). The repo only consumes credentials those consoles
issue.

### Prerequisites

- A **Google Cloud** project you can create OAuth clients in (Workspace admin
  access if you will restrict sign-in to your company).
- A **Supabase** account (hosted project; free tier is enough to start).
- A **Slack** workspace you can install apps into, and a Slack app at
  [api.slack.com/apps](https://api.slack.com/apps).
- A **Vercel** account (or equivalent) with permission to set env vars and
  attach a domain.
- Node.js **20** and **pnpm** **10** on any machine that will run the app
  (CI uses those versions). Docker + [Supabase CLI](https://supabase.com/docs/guides/cli)
  only if you want a **local** database instead of the hosted one.

### 1. Hosted Supabase project

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard).
2. **Project Settings → API**: copy **Project URL**, the **anon / publishable**
   key, and the **service_role / secret** key. The service role key is a
   secret: never put it in `NEXT_PUBLIC_*` or client code.
3. Apply every file in `supabase/migrations/` **in filename order** (SQL
   editor, or later `pnpm db:push` from a machine that has `supabase link`).
   Together they create:

   | Object | Purpose |
   |--------|---------|
   | `people` | One row per employee (`email`, `name`, `avatar_url`, optional `auth_user_id`, `slack_user_id`) |
   | `thanks` | One card: sender, `reason`, `source`, optional Slack message identity |
   | `thank_recipients` | People recognized by each card |
   | `people_with_stats` | View adding `thanks_received` / `thanks_given` |
   | `create_thanks_card` | RPC that writes a card + recipients in one transaction |

4. Hosted Supabase already grants table privileges to PostgREST roles. You do
   **not** need `supabase/seed.sql` on the hosted project (that file exists
   for **local** Docker, where those grants are missing).
5. Row Level Security is the security boundary: signed-in users can read the
   board; a web thanks can only be inserted with `from_person_id` equal to
   the caller's `people` row. Slack and seed writes use the service role
   after Slack signature verification (or an explicit seed script).

### 2. Google sign-in (Google Cloud + Supabase Auth)

ThankBot does not implement OAuth itself. It calls Supabase
`signInWithOAuth({ provider: "google" })`. You configure Google in two places.

**Google Cloud Console**

1. APIs & Services → Credentials → **Create OAuth client ID** (Web
   application).
2. Authorized **JavaScript origins**: your site origin (e.g.
   `https://thankbot.previewmach9.com`, `http://localhost:3000`).
3. Authorized **redirect URI** must be the **Supabase Auth callback**, not
   the Next.js app:

   ```
   https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
   ```

   Example for the current preview project:

   ```
   https://qewqxlzvlpgmhwibkfig.supabase.co/auth/v1/callback
   ```

4. Copy the client ID and client secret.

**Supabase dashboard**

1. **Authentication → Providers → Google**: paste the client ID and secret,
   enable the provider.
2. **Authentication → URL Configuration**:
   - **Site URL** = the public app origin (e.g.
     `https://thankbot.previewmach9.com`).
   - **Redirect URLs** must include every app callback you will use:

     ```
     https://thankbot.previewmach9.com/auth/callback
     http://localhost:3000/auth/callback
     ```

     Add any extra Vercel preview URLs you actually use for OAuth testing.

3. To keep the board to your company, restrict the **Google OAuth client** to
   your Workspace org (external accounts then cannot complete sign-in). First
   login creates a `people` row, or **claims** an existing row with the same
   email (seeded or Slack-created teammates).

### 3. Slack app (`/thanks`)

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps).
2. **OAuth & Permissions → Bot Token Scopes** — add all of:

   | Scope | Why |
   |-------|-----|
   | `commands` | Slash command |
   | `chat:write` | Announce the card as ThankBot (card page finds that message) |
   | `channels:join` | Join a **public** channel on first `/thanks` (no `/invite`) |
   | `reactions:read` | Emoji on that announcement (loaded on the card page) |
   | `channels:history`, `groups:history`, `im:history`, `mpim:history` | Thread replies on the card page |
   | `users:read` | Resolve `@mentions` |
   | `users:read.email` | Link Slack people to Google logins by email |
   | `channels:read`, `groups:read`, `im:read`, `mpim:read` | Conversation rosters (thank a lone teammate without a mention) |

   **Reinstall the app after adding scopes.** Slack keeps using the token it
   already issued. `/thanks` will keep working while emoji and replies stay
   invisible. `GET /api/health` lists scopes the install is still missing.

3. **User Token Scopes** (optional but required for private channels and DMs
   without `/invite`): `reactions:read`, `channels:history`, `groups:history`,
   `im:history`, `mpim:history`, `im:read`.

   A bot token is refused every conversation the app is not in. An app
   **cannot join** a private channel or a DM. A **user** token reads what its
   owner can see. The card page tries the bot token first, then
   `SLACK_USER_TOKEN`. Trade-off: replies read with that token are shown to
   **anyone signed in to the board**, including people not in the
   conversation. Leave `SLACK_USER_TOKEN` unset if that is unacceptable, and
   `/invite @ThankBot` instead.

4. Install the app. Copy **Bot User OAuth Token** (`xoxb-…`), optional
   **User OAuth Token** (`xoxp-…`), and **Signing Secret** (Basic
   Information).
5. **Slash Commands** → create `/thanks` with Request URL:

   ```
   https://<YOUR_PUBLIC_ORIGIN>/api/slack/thanks
   ```

   Example: `https://thankbot.previewmach9.com/api/slack/thanks`

   Slack always calls **this URL**. A code change to `/thanks` is live in
   Slack only when this URL points at a deployment that includes the change.
   For laptop testing, use a tunnel (`ngrok http 3000`) as the Request URL,
   or set `SLACK_SKIP_VERIFY=true` **only** on that laptop (never in
   production).

**Usage**

```
/thanks @alex for reviewing my PR
/thanks @alice @bob for shipping the release
/thanks everyone for covering on-call   # also: all, everybody, every body
/thanks for covering standup            # where ThankBot sees exactly one other person
```

List people as you would write them: `@alice, @bob`, `@alice, @bob, and
@carol`, `@alice; @bob`, `@alice & @bob`. Separators belong to the list, not
the reason. Mentions that are not in the conversation (or do not exist) are
skipped and reported back.

The no-mention form needs a single obvious recipient: a 1:1 DM with a
teammate (needs `SLACK_USER_TOKEN`), or a channel/group DM where ThankBot is
a member and exactly one other person is present. A 1:1 DM with ThankBot
itself has nobody to thank.

A recorded thanks posts in-channel: Slack `@mention`s each receiver, a
**View card** link, and a 1-second GIF (`/thanks/<id>/card.gif`, public so
Slack's crawler can fetch it without Google).

### 4. Vercel (or other host) and DNS

1. Import this repo. Framework preset: **Next.js** (no extra config).
2. Set environment variables (see [Environment variables](#environment-variables)).
   At minimum: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`. Add `SLACK_USER_TOKEN` if
   private-channel / 1:1 DM behavior is required.
3. Attach the public hostname. That exact origin must appear in:
   - Supabase Site URL + redirect list
   - Slack slash command Request URL
   - Google OAuth JavaScript origins (optional but recommended)
4. Apply any new `supabase/migrations/` files to the **hosted** database as
   part of the **same** release (`pnpm db:push` or SQL editor). CI does not
   do this. The app degrades rather than crashing when a migration is
   outstanding (e.g. a thanks before `0004_group_thanks_recipients.sql` is
   still recorded, but as one row per recipient instead of one shared card).
5. Reinstall the Slack app if the release added a bot (or user) scope.
6. Hit `GET https://<origin>/api/health`. Expect HTTP 200 and `"ok": true`.
   Point an uptime monitor at it.

### Outside-this-repo checklist

Copy this into a ticket when standing up a new environment.

- [ ] Supabase project created; URL + anon + service_role keys stored in a
      secret manager (not git)
- [ ] All `supabase/migrations/*.sql` applied in order on that project
- [ ] Google OAuth client: redirect = `https://<ref>.supabase.co/auth/v1/callback`
- [ ] Supabase Google provider enabled; Site URL + `/auth/callback` URLs set
- [ ] Workspace restriction on the Google client (if the board is internal)
- [ ] Slack app installed with bot scopes above; **reinstalled** after the
      last scope change
- [ ] `/thanks` Request URL = `https://<origin>/api/slack/thanks`
- [ ] Optional: user token scopes + `SLACK_USER_TOKEN` for private/DM reads
- [ ] Vercel env vars set; domain live; `/api/health` returns 200

---

## Setup (this repository)

### Humans — laptop against **hosted** Supabase (fastest)

Matches `.env.example` (preview project). You still need Google OAuth
redirect `http://localhost:3000/auth/callback` on that Supabase project.

```bash
git clone <this-repo>
cd thankbot          # directory name may match the clone
pnpm install
cp .env.example .env.local
# Edit .env.local: paste real keys. Do not commit it (.gitignore).
pnpm seed            # optional demo people + thanks (needs service role)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with Google.

### Humans — laptop against **local** Supabase (Docker)

Use this when you must not touch the hosted project, or when running DB-backed
scripts. Docker daemon and Supabase CLI must be installed.

```bash
# 1. Docker running (Linux VMs often need this; Docker Desktop elsewhere
#    usually already has a daemon).
sudo dockerd >/tmp/dockerd.log 2>&1 &   # only if dockerd is not already up

# 2. From the repo root: applies supabase/migrations/* then supabase/seed.sql
supabase start

# 3. Copy keys from `supabase status` into .env.local
```

`.env.local` for local stack:

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY from supabase status (sb_publishable_…)>
SUPABASE_SERVICE_ROLE_KEY=<SECRET_KEY from supabase status (sb_secret_…)>
NEXT_PUBLIC_ALLOW_SELF_THANKS=true
```

Use the **new-style** keys (`sb_publishable_…` / `sb_secret_…`). Legacy JWT
`anon` / `service_role` keys printed by `supabase status` are silently
downgraded to the `anon` role on the local stack and cause **permission
denied**.

**Gotcha — table grants.** Hosted Supabase auto-grants `public` tables to
PostgREST roles. Local does **not**. `supabase/seed.sql` reapplies those
grants and runs after migrations on `supabase start` / `supabase db reset`.
If you apply migrations by hand locally, run `supabase/seed.sql` or you will
see `permission denied for table people/thanks`. RLS in the migrations
remains the real security boundary.

**Google cannot complete locally** unless you also configure a Google client
against local GoTrue (unusual). To exercise **sending** a thanks without
Google:

1. Create a user in local GoTrue:
   `POST http://127.0.0.1:54321/auth/v1/admin/users` with the service role
   key, JSON `{ "email", "password", "email_confirm": true }`.
2. `POST /auth/v1/token?grant_type=password` for a session.
3. Call `POST /api/thanks` with that session cookie / `Authorization`.
   `getCurrentPerson()` creates or claims the matching `people` row on first
   authenticated request. `NEXT_PUBLIC_ALLOW_SELF_THANKS=true` lets one user
   thank themselves.

Then: `pnpm seed && pnpm dev`.

Restart `pnpm dev` after changing `.env.local`. Schema changes from
`supabase start` / `db reset` do **not** require a Next restart.

### AI agents — actionable setup

Follow this in order. Do not skip Docker for DB-backed tests.

1. Confirm Node 20 + pnpm 10. `pnpm install --frozen-lockfile`.
2. If `/tmp/cursor/async-install/install-user.status` (or equivalent env
   bootstrap) exists, wait until it is `0` before assuming deps are ready.
3. Start Docker if needed (`sudo dockerd >/tmp/dockerd.log 2>&1 &`). Do not
   change `/etc/docker/daemon.json`.
4. `supabase start` from repo root. Wait until it finishes (first run pulls
   images). Then `supabase status` and write `.env.local` with **publishable**
   and **secret** keys as above. Set `NEXT_PUBLIC_ALLOW_SELF_THANKS=true`.
5. `pnpm seed` (optional but recommended for a non-empty board).
6. `pnpm lint` and `pnpm build` (CI equivalents; build needs the public
   Supabase env vars — placeholders work if the DB is not contacted).
7. Offline assertion scripts (no DB):

   ```bash
   pnpm tsx scripts/test-parse.ts
   pnpm tsx scripts/test-recipient-list.ts
   pnpm tsx scripts/test-slack-recipients.ts
   pnpm tsx scripts/test-slack-card-gif.ts
   pnpm tsx scripts/test-slack-card-activity.ts
   pnpm tsx scripts/test-time-range.ts
   ```

8. DB-backed scripts (need local Supabase + `.env.local`):

   ```bash
   pnpm tsx scripts/test-thanks-write-paths.ts
   pnpm tsx scripts/test-schema-health.ts
   pnpm tsx scripts/test-slack-dm-flow.ts
   pnpm tsx scripts/test-slack-multi-recipient.ts
   ```

9. `pnpm dev` → `http://localhost:3000`. Home page **requires** a session;
   unauthenticated browsers land on `/login`. `/api/health` and
   `/api/slack/thanks` are public. To POST a web thanks, create a local
   GoTrue user as in the human local section.
10. Do not commit `.env.local`. Do not put service role or Slack tokens in
    source. Durable Cloud-agent notes live in `AGENTS.md`; keep product docs
    in this README.

---

## How it works

1. **Sign-in.** Google via Supabase Auth. Middleware
   (`src/middleware.ts`) refreshes the session cookie and sends visitors
   without a session to `/login`, except public paths in
   `src/lib/auth-paths.ts` (`/login`, `/auth/*`, `/api/slack`, `/api/health`,
   `/thanks/[id]/card.gif`).
2. **Web thanks.** Home form posts `POST /api/thanks`. The sender is taken
   from the session, **never** from the request body. Typeahead accepts
   several teammates (pick from the list, or type/paste names separated by
   commas, semicolons, or "and"). One send is one card.
3. **Slack thanks.** `/thanks …` hits `POST /api/slack/thanks`. People are
   upserted by `slack_user_id`. One card is shared by all recipients with
   `source=slack`. ThankBot announces with `chat.postMessage` and stores
   channel + timestamp so the **card page** (not the feed) can load Slack
   emoji and thread replies. If a public channel returns `not_in_channel`,
   it `conversations.join`s and posts again. Private channels and DMs cannot
   be joined; it falls back to the slash command `response_url`, then tries
   to find that announcement in history. Cards posted before Slack identity
   columns existed have no stored message, so their emoji will not appear
   until a new `/thanks`.
4. **Reads.** Feed, leaderboard, and `/people/[id]` read Postgres. The
   leaderboard ranks on the **selected period**, not all-time counts.

### When a card shows no Slack emoji or replies

Three independent gaps look identical to "nobody reacted":

- **Scopes.** New scopes require a **reinstall**.
- **Membership.** Slack only shows an app conversations it belongs to.
  `channels:join` covers public channels; private/DM needs `SLACK_USER_TOKEN`
  or `/invite @ThankBot`.
- **Schema.** `thanks.slack_channel_id` / `slack_message_ts` come from
  migrations applied by hand.

The card page names the reason it found. `GET /api/health` answers the same
for the whole deployment:

```json
{
  "ok": false,
  "pendingMigrations": [],
  "slack": {
    "ok": false,
    "configured": true,
    "missingScopes": ["reactions:read", "channels:history"],
    "user": { "ok": true, "configured": true, "missingScopes": [] }
  }
}
```

`slack.user` is present only when `SLACK_USER_TOKEN` is set. A token that
cannot do the job it is there for fails the check.

---

## Environment variables

```bash
cp .env.example .env.local
```

| Variable | Who sets it | Notes |
|----------|-------------|--------|
| `NEXT_PUBLIC_SITE_URL` | Human / Vercel | Public origin. OAuth `redirectTo` and Slack "View card" links. Local: `http://localhost:3000` |
| `NEXT_PUBLIC_SUPABASE_URL` | Human / Vercel | Hosted `https://<ref>.supabase.co` or local `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Human / Vercel | Anon / publishable key. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is also accepted in code |
| `SUPABASE_SERVICE_ROLE_KEY` | Human / Vercel | Seed + Slack writes + health probes. Server only. `SUPABASE_SECRET_KEY` accepted by `pnpm seed` |
| `SLACK_SIGNING_SECRET` | Human / Vercel | Slack app → Basic Information |
| `SLACK_BOT_TOKEN` | Human / Vercel | Bot User OAuth Token (`xoxb-`) |
| `SLACK_USER_TOKEN` | Human / Vercel | Optional User OAuth Token (`xoxp-`). Private/DM reads and mention-less 1:1 DMs |
| `SLACK_SKIP_VERIFY` | Human, laptop only | Skips HMAC verification. Never `true` in production |
| `NEXT_PUBLIC_ALLOW_SELF_THANKS` | Human, debug | `true` to thank yourself. Leave unset/false in production |

---

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/thanks` | Session | Recent thanks (`?limit=50`) |
| `POST` | `/api/thanks` | Session | Body `{ to_person_ids, reason }` (or legacy `to_person_id`) |
| `POST` | `/api/slack/thanks` | Slack signature | Slash command |
| `GET` | `/api/health` | None | Deploy check; `503` if schema or Slack scopes are behind |
| `GET` | `/thanks/[id]` | Session | Card page |
| `GET` | `/thanks/[id]/card.gif` | None | 1-second card GIF (Slack embed) |
| `GET` | `/api/people` | Session | People with received/given counts |
| `GET` | `/api/people/[id]` | Session | Person + received/given history |

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Development server |
| `pnpm build` | Production build (type-checks the project) |
| `pnpm start` | Run the production build |
| `pnpm seed` | Demo people + thanks (service role) |
| `pnpm db:push` | Apply `supabase/migrations/` to the **linked hosted** project |
| `pnpm lint` | ESLint |
| `pnpm tsx scripts/test-parse.ts` | Slack `/thanks` text parser |
| `pnpm tsx scripts/test-slack-card-gif.ts` | Mention reply + card GIF |
| `pnpm tsx scripts/test-slack-recipients.ts` | Recipient resolution without a mention |
| `pnpm tsx scripts/test-slack-card-activity.ts` | Announcement identity, emoji, replies |
| `pnpm tsx scripts/test-recipient-list.ts` | Web form typed/pasted name lists |
| `pnpm tsx scripts/test-time-range.ts` | Board period picker |
| `pnpm tsx scripts/test-thanks-write-paths.ts` | Web + Slack writes vs live schema (local DB) |
| `pnpm tsx scripts/test-schema-health.ts` | `/api/health` vs live schema (local DB) |
| `pnpm tsx scripts/test-slack-dm-flow.ts` | Slack DM flow end to end (local DB) |
| `pnpm tsx scripts/test-slack-multi-recipient.ts` | Multi-recipient thanks end to end (local DB) |

CI (`.github/workflows/ci.yml`) on `main` and PRs: `pnpm lint`, `pnpm build`,
and the six scripts that need **no** database. It does **not** deploy (Vercel
does) and does **not** run DB-backed scripts.

---

## Deploying to Vercel

Human release checklist (AI agents: do not apply hosted migrations or
reinstall Slack unless the operator asked):

1. Merge to the branch Vercel deploys. Confirm GitHub **CI** is green.
2. Confirm Vercel env vars match [Environment variables](#environment-variables).
3. Apply new files in `supabase/migrations/` to the hosted project
   (`pnpm db:push` after `supabase link`, or paste into the SQL editor).
4. Reinstall the Slack app if this release added scopes.
5. Confirm slash command Request URL still points at **this** deployment.
6. `GET /api/health` → 200. Example failure body:

   ```json
   {
     "ok": false,
     "shape": "legacy",
     "pendingMigrations": ["0004_group_thanks_recipients.sql"],
     "slack": {
       "ok": false,
       "configured": true,
       "missingScopes": ["reactions:read"]
     }
   }
   ```

---

## For humans — changing the product

- Prefer small PRs. Schema changes are a **new** file under
  `supabase/migrations/` (`0007_….sql`, never edit a migration that has
  already been applied to hosted). Mention in the PR that hosted `db:push`
  is required.
- New Slack scopes: document them here, add to health checks in
  `src/lib/schema-health.ts` / `src/lib/slack.ts`, and tell whoever owns the
  Slack app to **reinstall**.
- Web UI lives in `src/app/` and `src/components/`. Slack parsing and posting
  live in `src/lib/slack.ts` and `src/app/api/slack/thanks/route.ts`.
- Do not weaken RLS to "make local work"; fix grants via `supabase/seed.sql`
  locally instead.
- Self-thanks and `SLACK_SKIP_VERIFY` are debug switches, not production
  defaults.

---

## For AI agents — changing this codebase

- **Stack facts.** Next.js 14 App Router; server components are
  `force-dynamic` where they read cookies/DB. Package manager is **pnpm**
  (see `pnpm-lock.yaml`). Do not add npm/yarn lockfiles.
- **Do not** invent a test runner. Assertions are standalone
  `pnpm tsx scripts/test-*.ts` files. If you change parse/recipient/time-range
  behavior, extend the matching script and run it. If you change write paths
  or health, run the DB-backed scripts against `supabase start`.
- **Do not** call hosted Supabase or production Slack from an agent
  environment unless credentials were explicitly provided for that purpose.
  Prefer local `supabase start`.
- **Auth.** Never trust `from_person_id` from the client on web writes.
  Slack must `verifySlackRequest` before using the service role.
- **Public surface.** Keep `/api/health` free of board data (no names, rows,
  or counts). Keep `card.gif` public; keep the rest of `/thanks/[id]`
  session-gated.
- **Migrations.** Additive, idempotent where possible (`if not exists`). The
  app already degrades when `create_thanks_card` is missing — do not remove
  that fallback without a hard cutover plan.
- **Env.** Read `src/lib/supabase/env.ts` for key name aliases. After editing
  `.env.local`, restart `pnpm dev`.
- **Cursor Cloud.** Extra local-stack notes (dockerd, publishable keys,
  GoTrue user creation) are in `AGENTS.md`. Do not duplicate secrets there.

---

## Repository map

| Path | Role |
|------|------|
| `src/app/` | Routes: board, login, people, thanks card, API, auth callbacks |
| `src/components/` | Feed, form, leaderboard, Slack activity on a card |
| `src/lib/db.ts` | Board reads/writes, including migration fallbacks |
| `src/lib/slack.ts` | Signature verify, parse, post, join, history, health scopes |
| `src/lib/auth.ts` | Session → `people` row |
| `src/middleware.ts` | Cookie refresh + login wall |
| `supabase/migrations/` | Source of truth for hosted **and** local schema |
| `supabase/seed.sql` | Local PostgREST grants only |
| `scripts/` | Seed + assertion scripts |
| `.github/workflows/ci.yml` | Lint, build, offline tests |
| `AGENTS.md` | Cloud-agent local environment |

---

## License

Private application. All rights reserved unless a `LICENSE` file is added.
