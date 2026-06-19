# CPR — To-Do List

Derived from `ZOHO_PORTAL_REVIEW.md` (v2, June 16, 2026). Ordered by priority. See the review doc for full benefit/risk on each.

## Tier 1 — Do first (high impact, low risk)

- [x] **Extract `ensureValidZohoToken()` helper** — DONE. New `src/lib/server/zoho-token.ts` (+ 6 unit tests). Migrated 63 files (whole `src/lib/server` layer + ~46 routes). `ingest-mail.ts` (multi-user) and `trade-page-data.ts` (withTimeout) intentionally left. Verified: svelte-check clean (only pre-existing errors), 108/109 tests pass. *Uncommitted — needs commit + deploy.*
- [x] **Verify diagnostics auth guards** — DONE. All 7 (`trade-debug`, `deals-permission-test`, `client-login-diagnostics`, `client-dashboard-diagnostics`, `zprojects/diagnostics`, `zprojects/photos-diagnostics`, `zprojects/audit`) confirmed admin/trade-session guarded. No exposure.
- [x] **Dead-code cleanup (bonus)** — removed unused `toSafeIso` from 15 files + dead token imports from `trade/deals/+server.ts`.
- [ ] **Delete redirect-only trade routes** — `/trade/daily-log` and `/trade/report-issue` (both just redirect to `/trade/field-update`). No inbound links found. *Sandbox can't delete — do it in the commit (`git rm`).*
- [ ] **Zoho dead-weight pass** — VERIFIED June 16, 2026 against live CRM. ⚠️ `June Task - PDA Needed` is **ACTIVE** (last fired 2026-06-09) — do NOT delete. Hard-delete these 8 already-inactive, CRM-owned (`deletable:true`) Deals rules in the UI: `June Task - Deposit Invoice`, `Send Portal Invitation`, `PDA Signed: Send Client Portal Invitation`, `Auto Archive Closed Deals`, `Client Email - Jobsite Details`, `Estimate review needed follow up 1`, `Estimate review needed follow up 2`, `Start Date Determines Material Orders 2 Weeks Prior`. Separately review (inactive, may be intentionally retired): `Send Quote when Review is Booked`, `Contract Sent Follow-Up`. `Deals_ZohoFlow…Precon PDF` is `deletable:false` (Zoho Flow–owned) — remove it in **Zoho Flow**, not CRM. Rename junk functions: `xdmvc`, `Create_Cliq_Channels_for_Deal1`, `moveWorkDriveFolderOnCompletion2`. *No delete-rule API — all Zoho UI.*
- [ ] **Decommission legacy Zoho Creator portal path** — retire `Create client in zoho creator` and `Sync Project to Creator and Send Portal Invitation` (superseded by the SvelteKit portal).

## Tier 2 — Do next (medium effort, real payoff)

- [ ] **Merge the two migration directories** — reconcile `/migrations` + `/supabase/migrations` against the live prod schema, mark applied, drop the duplicate `designer_notes_cache`, delete obsolete `supabase-schema.sql`.
- [ ] **One WorkDrive "move folder on completion"** — keep the rule wired to the completion stage; deactivate-and-watch the other three before deleting.
- [ ] **One Cliq channel provisioner** — consolidate the ~7 channel-creation rules/functions; keep a single fallback "safety net," not three.
- [ ] **One project-creation chain** — pick one of the five project/WorkDrive functions; retire the rest after tracing the live path.
- [ ] **Rationalize follow-up rules** — map current cadence per stage (PDA / Ballpark / Estimate-Quote), get sales sign-off, consolidate, adopt naming `[Stage] FU [n] – [delay] – [channel]`. Keep the PDA cap at 5.
- [ ] **One contract-sent SMS sender** — route the rule + two functions through shared `SMS_Send_From_Deal`. (Don't rebuild on Voice.)
- [ ] **One phone normalizer** — single canonical function the CRM rules call; keep the portal `client-password.ts` copy byte-compatible.

## Tier 3 — Build out / when already in the code

- [ ] **Shared cache for multi-instance** — move hot in-memory caches in `projects.ts` onto the existing `api_response_cache` table (only matters once Render runs >1 instance).
- [ ] **Split the mega-files** — `projects.ts` (3,335), `db.ts` (1,952), `auth.ts` (1,599); keep public exports identical, move in small commits.
- [ ] **Per-deal bot sync UI** — add a "sync now / last synced X min ago" button (the `/api/admin/bot/sync` endpoint already exists).
- [ ] **Write the Zoho ↔ portal boundary doc** — "Zoho owns pipeline state + automations; portal reads, caches, presents."

## Sequencing notes

- Do **token helper (T1)** before the **migration merge** and **file splits** — they touch the same files.
- For every Zoho change: **deactivate-and-watch one deal**, or stage in a Zoho sandbox, before hard-deleting. These rules fire on live deals.

## Done / verified (no action needed)

- Invoices & financials display on `/dashboard`; `books.ts` is a real module.
- Schedule calendar live in admin + designer nav.
- `portal_session` shared by client/designer is intentional (`getPortalPrincipal`).
