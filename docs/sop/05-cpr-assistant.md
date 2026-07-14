# CPR Assistant (AI) — SOP

**Audience: admins and whitelisted staff. Route: `/admin/bot`.** Client and trade portals have their own scoped assistants; this doc covers the internal one.

---

## 1. What it is

The CPR Assistant is an internal AI that has read the company's data — emails, Cliq chat, WorkDrive documents, Zoho Books financials, Zoho Projects tasks, calendar, and contracts — and answers questions about it with citations. It's a retrieval-augmented (RAG) chatbot: relevant passages are pulled from a vector store and given to the model to answer from, so it quotes real records rather than guessing.

**Models:** chat is `gpt-4o-mini`; embeddings are `text-embedding-3-small` (1536-dim); document OCR uses `gpt-4o-mini` vision.

## 2. The three modes

The `/admin/bot` page has three tabs.

**Deal bot (per-deal).** Pick a deal from the selector, then ask about just that project. It injects a complete Books financial block and the full WorkDrive document inventory so totals and file lists are exact. It has sync buttons, quick prompts, a 10-source picker, and saved conversation threads. Streams answers token-by-token.

- The deal list comes from `/api/admin/bot/deals`, which now uses Zoho **COQL** (`SELECT ... FROM Deals WHERE Stage != 'Lost' and Stage != 'Completed' ORDER BY Modified_Time DESC`). COQL is used deliberately instead of `/Deals/search`, because search's chained `not_equal` on picklist stages with spaces (like "On Hold") is unreliable and was dropping deals. **On-Hold deals stay selectable** — this is the fix that made accounts like Lisbeth Ojemann appear.

**Master bot (across all deals).** No deal selector — asks across the entire corpus (excluding company-wide Cliq channels), defaulting to active projects, tagging each passage with its project. Admin-only. Handles company-wide questions like "who's working today" and schedule/overview queries. Stateless (full history sent each turn), non-streaming.

**Comms bot (email + Cliq only).** Restricts retrieval to email and Cliq sources (including company-wide channels). Admin-only. Its own Sync Email and Sync Cliq buttons.

## 3. How syncing works

The assistant only knows what's been synced into Supabase. Syncing walks a deal's sources and writes embedded chunks to the vector store.

- **What gets synced per deal:** Cliq (internal/external), Mail (mailbox summaries + CRM email related list), WorkDrive files (PDF/DOCX/XLSX, with OCR fallback and transcripts), Books (invoices/estimates/payments), Zoho Projects (tasks/activities), Calendar, Sign requests, and company-wide Cliq channels (org-level, synced once per run).
- **Where it lands:** metadata in Supabase `bot_documents`; embedded chunks in `bot_chunks` (pgvector). A run is recorded in `bot_sync_runs`.
- **How it's triggered:** the cron job `/api/cron/sync-active-deals` (~every 2h), the "Run sync now" button on the health page, and the per-source buttons in the chat panels. Most runs are fire-and-forget (`detached`).
- **Stage rule:** the org sync excludes only `Lost` by default; the deal picker additionally hides `Completed`. On-Hold is always included in both.

## 4. How retrieval works

For a single deal, the assistant runs several retrieval lanes in parallel — semantic similarity, recency, keyword match, an always-on financial lane, and an always-on documents lane — then merges and diversifies them with per-source caps so one source can't crowd out the rest. The master bot uses a corpus-wide match. Role restrictions (below) filter sources, folders, and subjects before results reach the model. The system prompt is strict: read-only, internal, citations required (`[#N]`).

## 5. Who can use it, and what they can see

Access is decided by `getBotAccess`:

- **Admin** — no source filter, full financials, every deal.
- **Designer (whitelisted)** — same data access as admin; those also in the admin list get the Master and Comms bots too. Whitelisted via `BOT_CHAT_ALLOWED_EMAILS`.
- **Trade partner** — heavily restricted: Designs-family WorkDrive only, financials hidden, pricing/bid/quote/contract files blocked.
- **Client** — their own project folder only, internal financials scrubbed.

An internal user who is also a trade partner resolves as internal first, so they keep financial access rather than being downgraded.

## 6. Health and connected users

**Bot Health (`/admin/bot/health`).** "CPR Assistant Sync Health" — the last 25 sync runs with trigger, sources, deal counts, ok/error counts, duration, and expandable per-deal errors. A "Run sync now" button kicks a detached org sync. (It reports sync-run status, not document counts by type.)

**Bot Users (`/admin/bot/users`).** "Connected Zoho Users" — manages the Zoho OAuth tokens. Because Zoho Mail is per-user, each mailbox needs its own connected token. Actions: make a user **primary** (the token used for CRM/Cliq/Books), remove a user, or add another via the OAuth flow.

## 7. Gotchas

1. **The picker uses COQL, not `/Deals/search`** — keep it that way; search silently drops On-Hold and other spaced-stage deals.
2. **The assistant only knows what's synced.** If a deal wasn't synced, the assistant can't answer about it even though it's selectable. Run a sync.
3. **Two crew-shift stores.** The Master bot's scheduling reads `cpr_shifts`/`cpr_crew`, which is a separate mirror from the admin Schedule page's `connecteam_shifts`. They can drift.
4. **Mailbox sync stores summaries, not full bodies** by default, and each mailbox needs its own connected token due to Zoho Mail privacy.
5. **Two cron/secret schemes** protect the sync endpoints (`x-cron-secret` header vs `Authorization: Bearer`), both keyed on `BOT_CRON_SECRET`.
6. **Requesting unsupported sources in a detached org sync is silently ignored** — only Cliq, Cliq channels, Mail, and Books are honored on that path.
7. **Email content depends on OAuth scope.** The CRM email-body scope is limited, so bodies are served from the synced copy where the live CRM detail isn't available.
