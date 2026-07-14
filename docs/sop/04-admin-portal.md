# Admin Portal — SOP

**Audience: CPR administrators. Route: `/admin`.** The CPR Assistant has its own doc: [05-cpr-assistant.md](05-cpr-assistant.md).

---

## 1. Purpose and users

The Admin Portal is the internal control console layered on the same app. It bundles the AI assistant, per-deal operational tools (approvals, change orders, daily logs, comms, field issues, procurement), the scope-to-Zoho-Projects generation engine, lead management, crew scheduling, and integration diagnostics.

## 2. How admins log in

- **Entry:** `/admin/login`. Two credential paths: an **env admin** (email in `PORTAL_ADMIN_EMAILS`, shared `PORTAL_ADMIN_PASSWORD`), or a **per-user row** in Supabase `admin_users`.
- **Session:** a stateless signed `admin_session` cookie (default 12-hour TTL).
- **After login:** the app also seeds a designer `portal_session` (and a `trade_session` if applicable) and sends the admin to `/designer`. That's why admins work from the staff dashboard with amber admin tabs added.
- **Logout** clears only `admin_session`, leaving the designer/trade sessions.

Every admin page and API checks the admin session. Two exceptions have no server guard and rely on their APIs' own checks: the `/admin` index and `/admin/connected`.

## 3. The admin index

`/admin` shows a deal selector; picking a deal loads six collapsible cards — Approvals, Change Orders, Daily Logs, Comms, Field Issues, Procurement — each from its own per-deal API. (A separate KPI-aggregate endpoint exists but the index doesn't use it.)

## 4. Tools, one by one

**Clients (`/admin/clients`).** Portal administration. Sync **CRM Contacts** on active-stage deals into the Supabase `clients` table (seeding each password to their phone number), sync trade partners, and audit project mapping. Set/reset passwords for clients, trades, and designers. Two diagnostics help debug logins and dashboards: **client-login-diagnostics** (compares local vs live Zoho phone — "why can't this client log in") and **client-dashboard-diagnostics** (per-deal counts feeding a client's dashboard).

**Scope / SOW (`/admin/scope`).** The scope-to-project engine — the core automation.

1. Pick a deal → the **Scope Builder** shows a CRM scope reference, a task builder, and a generate panel.
2. **Parse** extracts tasks with `gpt-4o-mini` from an uploaded estimate PDF or from the Deal's scope fields (`Refined_Scope`, `Scope`, etc.), writing rows to Supabase `scope_tasks` (name, phase, trade, duration, inspection/decision flags).
3. **Generate** builds the actual **Zoho Project** from those tasks — project → phases → task lists → tasks — writes `Project_ID` back to the Deal, creates client-decision approvals, logs progress, and auto-attaches QC checklists.

A printable **SOW** page renders a Scope of Work for a deal. (A second, template-based generation path exists; staff should use the AI Scope Builder path.)

**QC checklists.** `generateSubtasksForProject` classifies each Zoho task to a trade with `gpt-4o-mini` and inserts that trade's verbatim checklist items into Supabase `task_subtasks`. Runs at the end of Generate or manually per project. (Trades then check them off — see [Trade Portal](02-trade-partner-portal.md).)

**Change Orders (`/admin/change-orders`).** Supabase `change_orders`. Lifecycle: identified → scoped → sent → approved → billed (or rejected), driven by buttons. Summary cards: Total Estimated, Total Approved, Unbilled, Revenue at Risk.

**Daily Logs (`/admin/daily-logs`).** Read-only view of `daily_logs` submitted by trade partners — date, hours, work done/planned, issues, photos, weather delays — grouped by date with summary stats.

**Email Updates (`/admin/email-updates`).** Manages per-deal digest preferences (daily/weekly/none) and can build an HTML digest from recent activity. **Sending is not implemented** — the tool only logs a `sent_emails` row and previews the HTML. No mail provider is wired; flag as an open item.

**Field Issues (`/admin/field-issues`).** Supabase `field_issues` (type, severity, status), created from the trade portal. Grouped by severity; actions Acknowledge and Resolve. Separately, a one-time **sync-field-updates** backfill pushes Supabase `field_updates` into the Zoho CRM Field_Updates module (Supabase → Zoho, not the reverse).

**Leads (`/admin/leads`).** Pure Zoho CRM Leads (no Supabase). Lists leads across four intake statuses and edits discovery fields (notes, budget, finishes Good/Better/Best, timeline). Lead file fields go through Zoho CRM's field upload/download (not WorkDrive).

**Procurement (`/admin/procurement`).** Supabase `procurement_items` (material/fixture/appliance/custom, vendor, cost, lead time, dates, status). Lifecycle buttons move items needed → ordered → shipped → delivered → installed (with damaged/reorder branches).

**Task Library (`/admin/task-library`).** Supabase `task_templates` — the master catalog behind template-based scope generation. Project types (hall_bath, primary_bath, kitchen, basement, deck) and phases (preconstruction, demo, rough, finish, closeout). Full CRUD; Deactivate is a soft delete.

**Z Projects (`/admin/zprojects`).** Zoho Projects diagnostics — four read-only panels: OAuth scope + candidate project fields, photo-link resolution, project-mapping audit, and raw portals payload (to find the portal id).

**Approvals (`/admin/approvals`).** Supabase `approvals` (category, assigned_to client|admin, status, priority, due date). `assigned_to` controls client vs admin visibility. Approve/Reject/Defer with a note; Create new.

**Schedule (`/admin/schedule`).** Crew schedule from Connecteam **iCalendar feeds** (one per person). Manage feeds and **Sync now** into Supabase `connecteam_feeds` / `connecteam_shifts`. Monday-anchored week grid in Mountain time.

**Process Map (`/admin/process-map`).** An interactive, hard-coded reference of CPR's full sales-to-completion workflow (7 phases plus exits, change orders, and automations, annotated with Zoho workflow/Blueprint/Sign/Books/Cliq references). Only per-step **Team Notes** persist (Supabase `process_map_notes`).

**Health (`/admin/health`).** Project-health scoring (not integration uptime). Pulls active deals and scores five signals — schedule, budget (placeholder), issues, decisions, comms SLA — weighted and sorted worst-first.

**Connected (`/admin/connected`).** A static post-OAuth confirmation screen. Does not show live connection state.

**API Cache (`/admin/api-cache`).** Inspect and purge cached third-party API responses (`api_response_cache`). Clear stale, all, by pattern, or one row.

**Folder Cache (`/admin/folder-cache`).** Cached WorkDrive folder ids per deal (`workdrive_folder_cache`, 7-day TTL). Clear expired, all, or by deal.

**Bot Health / Bot Users.** See [05-cpr-assistant.md](05-cpr-assistant.md).

## 5. Scheduled jobs and automation

- **Bot sync cron** — `/api/cron/sync-active-deals` (Render Cron ~every 2h, `x-cron-secret` header) syncs active deals into the AI knowledge base.
- **Cliq channel sync** — separate org-wide sync.
- **Schedule sync** — manual "Sync now" imports Connecteam feeds.
- **Send updates** — manual; logs only (no real send).
- **Checklist generation** — automatic at the end of Generate, or manual per project.
- **sync-field-updates** — one-time Supabase → Zoho backfill.

## 6. Data sources

Zoho CRM (Deals, Contacts, Leads, Tasks, Field_Updates, settings/fields), Zoho Books (invoices, estimates, payments), Zoho Projects (projects/phases/tasks), Zoho WorkDrive, Zoho Cliq, Zoho Mail, Zoho Calendar, Zoho Sign, and Connecteam. Supabase holds ~35 tables (clients, admin_users, trade_partners, the `bot_*` knowledge base, `cpr_shifts`/`cpr_crew`, connecteam feeds/shifts, WorkDrive caches, `zoho_tokens`, scope/task tables, approvals, change_orders, daily_logs, field_issues, field_updates, procurement, comms_log, email_preferences, sent_emails, process_map_notes). OpenAI (`gpt-4o-mini`, `text-embedding-3-small`).

## 7. Gotchas

1. **Two parallel crew-shift stores.** The Schedule page uses `connecteam_feeds`/`connecteam_shifts`; the AI assistant reads a separate `cpr_shifts`/`cpr_crew` mirror. Editing feeds in the Schedule UI does not populate what the bot sees.
2. **Email digests don't send** — only logged and previewed.
3. **Uneven auth gating.** The `/admin` index and `/admin/connected` have no server guard (rely on API 401s); logout clears only the admin cookie.
4. **Two scope-to-project paths** (AI `scope_tasks` vs template-based). Point staff at the AI Scope Builder.
5. **Email-mismatch financials.** Books data is matched by the deal contact's email; a wrong/missing email yields no invoices.
6. **sync-field-updates is a one-time backfill**, Supabase → Zoho — not a two-way sync.
7. **Two cron auth schemes** share `BOT_CRON_SECRET`: the cron uses an `x-cron-secret` header; the sync endpoints use `Authorization: Bearer`.
8. **On-Hold deals** are excluded from some "active" views but must stay visible in the assistant deal picker (see [05](05-cpr-assistant.md)).
