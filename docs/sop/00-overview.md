# CPR Portal — Handoff Packet & SOP

**Overview and system map. Read this first.**

_Last updated: July 2026. Owner: Ray (ray@itsfait.com)._

---

## What this packet is

The CPR Portal is one SvelteKit application that serves four different audiences from the same codebase. Each audience sees a different "dashboard." This packet documents each dashboard in its own file so a new operator, developer, or support person can understand what it does, who uses it, and how it works.

| Doc | Dashboard | Who uses it |
|-----|-----------|-------------|
| [01-client-portal.md](01-client-portal.md) | Client Portal | Homeowners (renovation clients) |
| [02-trade-partner-portal.md](02-trade-partner-portal.md) | Trade Partner Portal | Subcontractors (framers, plumbers, electricians, etc.) |
| [03-designer-portal.md](03-designer-portal.md) | Designer / Staff Portal | Internal CPR staff (designer, ops, finance) |
| [04-admin-portal.md](04-admin-portal.md) | Admin Portal | CPR administrators |
| [05-cpr-assistant.md](05-cpr-assistant.md) | CPR Assistant (AI) | Admins and whitelisted staff |

## The one-paragraph summary

CPR runs its business in Zoho. The portal is a friendlier, role-scoped window onto that Zoho data plus a Supabase database that stores portal-specific state (logins, checklists, change orders, AI knowledge). Homeowners track their project and pay invoices. Subcontractors update task status and submit field reports. Staff manage deals, scope, and finances. Admins run the whole thing and talk to an AI assistant that has read the company's email, chat, documents, and financials.

## The stack

- **Front end / server:** SvelteKit (Node adapter), deployed on Render.
- **Database:** Supabase (Postgres). Stores portal logins/sessions, checklists, change orders, approvals, procurement, the AI knowledge base (pgvector), and cached Zoho lookups.
- **System of record:** Zoho — CRM (Deals, Contacts, Leads, Tasks, a custom Field_Updates module), Books (estimates, invoices, payments), Projects (tasks), WorkDrive (files/photos), Cliq (chat), Sign (contracts), Mail, Calendar, Bookings.
- **Crew scheduling:** Connecteam (imported as iCalendar feeds).
- **AI:** OpenAI — `gpt-4o-mini` for chat, summaries, scope parsing, and checklist matching; `text-embedding-3-small` for the vector store.
- **Repo:** github.com/Faitltd/cpr-client-portal.

## How the pieces fit

A **Deal** in Zoho CRM is the spine of everything. One renovation = one Deal. Every portal keys off the Deal:

- The homeowner is the Deal's **Contact**.
- The subcontractor is linked to the Deal through the **Portal_Trade_Partners** (or **Assigned_Subs**) field.
- Financials come from the **Zoho Books customer** matched to the Deal's contact email.
- Tasks come from the **Zoho Project** linked to the Deal (`Project_ID` / `Zoho_Projects_ID`).
- Files and photos live in the Deal's **WorkDrive** folder.
- The AI assistant's knowledge is everything synced about that Deal into Supabase.

Supabase holds what Zoho can't: portal passwords and sessions, QC checklists, the AI knowledge base, and operational tables (approvals, change orders, daily logs, procurement, field issues).

## Roles and logins at a glance

There are four session cookies. A user can hold more than one at a time.

| Cookie | Role | Login page | Store |
|--------|------|-----------|-------|
| `portal_session` | Client **or** Designer/Staff | `/auth/client`, `/auth/portal` | Supabase `client_sessions` / `designer_sessions` |
| `trade_session` | Trade partner | `/auth/trade` | Supabase `trade_sessions` |
| `admin_session` | Admin | `/admin/login` | Signed HMAC cookie (stateless) |

Key facts:

- **Clients and trade partners** log in with **email + password**, where the seed password is their **phone number on file**. There is no "forgot password" flow — recovery is the phone-number fallback, or an admin reset.
- **Staff/designers** are rows in the Supabase `designers` table with sub-roles `designer`, `ops`, or `finance`.
- **Admins** are either an env-configured shared admin (`PORTAL_ADMIN_EMAILS` + `PORTAL_ADMIN_PASSWORD`) or rows in `admin_users`. Logging in as admin also seeds a designer session, so admins land on the staff dashboard with extra amber admin tabs.
- **All Zoho writes are performed with a single stored admin OAuth token**, not per-user tokens. The portal remembers "who really did it" by convention (e.g., a note title), not by Zoho identity.

## Deal stages that matter

Stage names in Zoho drive what each portal shows. Common values: Design Needed, Estimate Needed, Quoted, Contract Sent, **Project Created**, Project Started, **On Hold**, Completed, Lost. Two recurring rules:

- The **AI assistant deal picker** hides `Lost` and `Completed` but keeps `On Hold` selectable.
- Some staff/admin views filter to "active" stages; **On Hold and Lost are not "active."** This has caused clients like On-Hold accounts to disappear from views — see the per-dashboard gotchas.

## Deploying

Push to `main` → Render auto-builds (adapter-node). For dependency or env changes, use Render's **Manual Deploy → Clear build cache & deploy**. Node is pinned to 22.x; dependencies are pinned exactly to avoid boot failures from lockfile drift.

## Cross-cutting gotchas (every operator should know)

1. **Phone number is a permanent backdoor password** for clients and trades, even after they set a custom password. Deactivating a user means removing their row/password, not just a flag.
2. **Financials depend on matching the Deal's contact email to a Zoho Books customer.** A mismatched email means no invoices show. The client portal can auto-heal this (see [01](01-client-portal.md)); otherwise an admin sets `books_customer_id` manually.
3. **Email digests do not actually send yet** — the admin "Send Updates" tool only logs and previews. No mail provider is wired.
4. **Two crew-schedule stores exist** — the admin Schedule page and the AI assistant read different tables. Editing feeds in one does not populate the other.
5. **Everything client-facing is fetched after page load**, so slow Zoho calls appear as in-page loading states, not server errors.
