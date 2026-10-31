# Support Inbox

A shared inbox for a 4-person support team. Customer emails become tickets, an AI call suggests
a category, an urgency and a draft reply, and an agent reviews and sends it. Nothing is sent
automatically.

```
Gmail (label "support") ──Apps Script──▶ POST /api/webhook/email ─┐
Web form ("Log a ticket") ─────────────▶ POST /api/tickets ────────┤
                                                                   ▼
                  ┌──────── Caddy (HTTPS, serves React build) ─────────┐
 Browser ────────▶│  /        → React + Vite SPA                        │
                  │  /api/*   → Express API ──▶ SQLite (Drizzle)        │
                  └───────────────────────────────┬─────────────────────┘
                                                  ├─▶ AI: 1 call per ticket (DeepSeek, OpenAI-compatible)
                                                  └─▶ SMTP: Mailpit (demo) or Gmail/any provider (production)
```

## What it does

- **Sign-in with two roles.** Agents and admins see every ticket. Only the assignee or an admin can
  edit, send or close; only admins can reassign.
- **Tickets arrive two ways:** a webhook (protected by a shared secret, duplicates ignored by
  `Message-ID`) and a "Log a ticket" form.
- **Automatic assignment** to the active agent with the fewest open tickets.
- **Ticket list** filtered by status, paged (20 per page), with views for My tickets, All, Overdue
  and Closed, refreshing every 10 seconds.
- **One AI call per ticket**, in the background, returning `{category, urgency, draft_reply}` as
  JSON. The response is validated with zod; anything else (bad JSON, unknown category,
  `urgency: 99`, extra keys, cut-off output) shows an error instead of a draft. Agents can retry at
  most twice. Auto-replies, bounces and no-reply senders skip the AI entirely.
- **Human-approved sending.** The agent edits the draft and confirms before sending. Each reply is
  recorded with who sent it and when, double clicks can't send twice, and a failed send can be
  retried. Replies thread in the customer's mail client.
- **Stretch goal: overdue marker** for tickets older than 24 hours without a reply, with its own
  filter.

## Run locally

Requires Docker.

```sh
cp .env.example .env          # works as-is for a local demo; add AI_API_KEY for real AI drafts
docker compose up --build
```

- App: <http://localhost>. Seeded users: `sara@team.local` (admin), `ali@`, `maya@`,
  `omar@team.local` (agents). The password is `SEED_PASSWORD` from `.env`.
- Load the sample emails: `npm ci && npm run samples` (12 emails, including an auto-reply, a bounce,
  a follow-up and a prompt-injection attempt).
- Sent replies (demo mode): Mailpit at <http://localhost:8025>.

After editing `.env`, run `docker compose up -d` again. Containers only read `.env` when created.

### Development

```sh
npm ci
npm run dev       # API on :3000 (tsx watch) + Vite on :5173, with /api proxied
npm test          # Vitest + Supertest (120 tests, AI and SMTP are faked)
npm run lint      # ESLint + TypeScript type checks
```

## Configuration

All settings are environment variables; see [.env.example](.env.example) for every one with notes.

| Area | Variables |
|---|---|
| Auth | `SESSION_SECRET` (32+ chars), `COOKIE_SECURE` (true behind HTTPS), `SEED_USERS`, `SEED_PASSWORD` |
| Webhook | `WEBHOOK_SECRET` (16+ chars), sent as the `X-Webhook-Secret` header |
| AI | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (default `deepseek-chat`), `AI_MAX_TOKENS` |
| Mail | `MAIL_MODE` (`demo` or `production`), `SMTP_*`. Demo mode refuses any host except Mailpit. |
| Web | `SITE_ADDRESS` (`:80` locally; a hostname in production for automatic HTTPS) |

Secrets are never logged; config errors name the variable, not its value.

## Gmail connector

A Google Apps Script ([integrations/gmail/Code.gs](integrations/gmail/Code.gs)) forwards only
emails with the Gmail label `support` to the webhook, checking every minute.

1. In Gmail, create a filter: **To** `yourname+support@gmail.com` → **Apply label** `support`.
2. At <https://script.google.com>, create a project and paste in `Code.gs`.
3. **Project Settings → Script properties:** `WEBHOOK_URL` = `https://<host>/api/webhook/email`,
   `WEBHOOK_SECRET` = the server's value.
4. Run `installTrigger` once and approve the permissions.

The script keeps a time cursor with a 5-minute overlap and relies on the server's duplicate
check, so follow-ups in the same thread aren't missed. Google's permission prompt asks for broad
Gmail access; use a dedicated support mailbox for real use.

To test against a local run, `docker compose --profile tunnel up -d` starts a Cloudflare quick
tunnel that exposes **only** `/api/webhook/*` (`docker compose logs tunnel` shows the URL).

## Deploy to AWS EC2

GitHub Actions tests every push. On `main` it builds the two images (API and Caddy + client), pushes
them to GitHub Container Registry tagged with the commit sha, then SSHes into EC2 to pull and
restart. The server never builds anything.

### One-time setup

1. **Launch an instance:** t3.small (2 GB), Amazon Linux 2023 or Ubuntu 24.04, 20 GB disk.
   Security group: inbound 80 and 443 from anywhere, and 22 for SSH (see the note below). Allocate an
   Elastic IP so the address survives restarts.
2. **Prepare it:** SSH in and run
   ```sh
   curl -fsSL https://raw.githubusercontent.com/devSohailK/support-box/main/scripts/ec2-setup.sh | bash
   ```
   This installs Docker and Compose, adds swap, and creates `~/support-box`. Log out and back in.
3. **Create `~/support-box/.env`** from `.env.example` with production values: new random
   `SESSION_SECRET` and `WEBHOOK_SECRET`, a strong `SEED_PASSWORD`, `COOKIE_SECURE=true`,
   `SITE_ADDRESS=<elastic-ip-with-dashes>.sslip.io` (or your domain), `AI_API_KEY`, and the mail
   settings.
4. **In GitHub → Settings → Secrets and variables → Actions**, add:
   | Kind | Name | Value |
   |---|---|---|
   | Secret | `EC2_HOST` | Elastic IP or hostname |
   | Secret | `EC2_USER` | `ec2-user` (Amazon Linux) or `ubuntu` |
   | Secret | `EC2_SSH_KEY` | private key of the instance's key pair |
   | Secret | `EC2_KNOWN_HOSTS` | *(recommended)* output of `ssh-keyscan <host>`, to pin the host key |
   | Variable | `DEPLOY_ENABLED` | `true` |
5. Push to `main`, or run the workflow by hand (**Actions → CI/CD → Run workflow**).

Until `DEPLOY_ENABLED` is set, the workflow still tests and builds but skips the deploy.

**SSH access:** GitHub's runners use changing IP addresses, so port 22 has to accept them. Use
key-only SSH (the default on EC2 images). To close port 22 entirely, switch the deploy job to AWS
Systems Manager (`aws ssm send-command` with GitHub OIDC); that's listed under improvements.

### Operations

- **Roll back:** `cd ~/support-box && IMAGE_TAG=<older commit sha> ./deploy.sh`
- **Logs:** `docker compose logs -f app`
- **Data:** SQLite lives in the `app-data` Docker volume. Take a consistent backup while running:
  ```sh
  docker compose exec app node -e "new (require('better-sqlite3'))('/data/app.db').backup('/data/backup.db')"
  docker compose cp app:/data/backup.db ./backup-$(date +%F).db
  ```
  EBS snapshots of the volume work too.
- **Mailpit UI on the server:** `ssh -L 8025:localhost:8025 <host>` then open <http://localhost:8025>.

## What I left out

- **Email threading.** Every incoming email is a new ticket. The ticket page lists other tickets from
  the same sender to soften this.
- **Admin user management UI.** Users come from `SEED_USERS`; deactivation is a database change.
- **Audit log for reassignments.** Only sent replies are recorded with who and when, as the brief
  requires.
- **Live push updates.** Lists refresh every 10 seconds instead of using WebSockets or SSE.
- **Help-article grounding** for drafts (the third stretch option).
- **Managed database and multiple instances.** One EC2 instance with SQLite fits 4 users;
  RDS/Postgres would be the next step.

## Known problem: a crash during sending leaves a reply stuck as "Sending"

To prevent double sends, the reply record is written and locked **before** the SMTP call. If the
server dies after that write but before SMTP answers, the reply stays `pending` and the ticket
stays `replied`. Nobody can tell whether the customer got the email, and the UI won't allow
resending.

**How I would fix it:** move sending to a small outbox worker. Sending creates the reply with a
stable `Message-ID` and status `queued`; the worker delivers it and marks it `sent` or `failed`.
On startup, the worker resolves any `pending` row older than a few minutes: it checks the provider
(for Gmail, the Sent folder by `Message-ID`; for an API provider, its idempotency key) and either
marks it `sent` or makes it resendable. Agents would see "Delivery unknown, check before resending"
instead of a silent stuck state.

## Project layout

```
client/     React + Vite UI (plain CSS, design tokens in src/styles/tokens.css)
server/     Express API, Drizzle schema and migrations, AI triage, mailer, tests
shared/     zod schemas and types used by both sides
samples/    sample emails for the webhook
scripts/    send-samples, EC2 setup, deploy
integrations/gmail/   Apps Script connector
.github/workflows/    CI/CD
```
