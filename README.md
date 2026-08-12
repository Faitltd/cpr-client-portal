# CPR Client Portal

Custom client portal for Custom Professional Renovations built with SvelteKit and Zoho CRM API integration.

## Features

- Admin OAuth 2.0 connection with Zoho CRM
- Client login via password (admin-managed)
- Real-time project/deal access from Zoho CRM
- Server-side token storage in Supabase
- Contact-specific data isolation

## Getting Started

### Prerequisites

- Node.js 20+
- Zoho CRM account with API access
- Zoho Developer Console application configured
- Supabase project

### Setup

1. Clone the repository:
```bash
git clone https://github.com/Faitltd/cpr-client-portal.git
cd cpr-client-portal
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Register your application in Zoho Developer Console:
   - Application Type: Server-based
   - Authorized Redirect URI: `http://localhost:5173/auth/callback` (development)
   - Required Scopes: use the `ZOHO_SCOPE` value from `.env.example` (comma-separated, no extra tokens)

5. Update `.env` with your credentials:
   - `ZOHO_CLIENT_ID`
   - `ZOHO_CLIENT_SECRET`
   - `ZOHO_REDIRECT_URI`
   - `ZOHO_BOOKS_ORG_ID`
   - `ZOHO_TRADE_PARTNERS_MODULE`
   - `ZOHO_SIGN_HOST`
   - `ZOHO_PROJECTS_API_BASE`
   - `ZOHO_PROJECTS_PORTAL_ID`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

6. Install Supabase schema:
   - Run `supabase-schema.sql` in the Supabase SQL Editor

7. Run development server:
```bash
npm run dev
```

8. Connect Zoho (admin):
   - Visit `http://localhost:5173/auth/login` once

9. If you add scopes later:
   - Re-authorize via `/auth/login` so the stored refresh token includes new scopes.
   - The login route now ignores unknown scope tokens in `ZOHO_SCOPE` to prevent OAuth failures.

10. Zoho Projects portal discovery:
   - Log in as admin and call `/api/zprojects/portals`
   - Set `ZOHO_PROJECTS_PORTAL_ID` from the returned portal id
   - Restart the app after updating env vars

11. Mapping audit (admin):
   - Call `/api/zprojects/audit`
   - Confirm `summary.missingDeals` is `0` (or review `sampleMissingDeals` for fixes)

12. Client login:
   - Visit `http://localhost:5173/auth/client`
   - Enter email + password
   - Admins can set/reset passwords at `/admin/login`

## Password Login

Clients sign in with a password (no email required). Passwords are stored as PBKDF2 hashes in `clients.password_hash`.

- Or set a hash directly in Supabase if you are migrating existing users.

## Admin Password Reset (No Email)

Use `/admin/login` to sign in with the admin password and set/reset client passwords.

- Set `PORTAL_ADMIN_PASSWORD` in `.env`.
- Click "Sync Clients from Zoho" in `/admin/clients` to pull contacts tied to active deals.
- Clients can then log in with email + password at `/auth/client`.

## Trade Partner Login

Trade partners sign in at `/auth/trade` using email + password. Accounts live in the `trade_partners` table.

- Trade partners are synced from Zoho CRM Custom Module (default `Trade_Partners`) using the admin OAuth token.
- Deals are filtered by the Deal lookup field `Portal_Trade_Partners` (Trade Partner -> Deal link).
- Related list lookups can be configured with `ZOHO_TRADE_PARTNER_RELATED_LIST` (default `Deals,Portal_Deals`).
- Use **Sync Trade Partners** in `/admin/clients` after OAuth.
- Set/reset passwords in `/admin/clients` under Trade Partner Passwords.
- Sessions are stored in `trade_sessions`.

## CAD Converter (ProKitchen → Chief Architect)

Designers convert a ProKitchen DWG export into a Chief Architect import-ready DXF at
`/designer/cad-converter`. The tab is visible to staff with the `designer` role and to admins.

Workflow: ProKitchen → Export DWG → drop on the page → download DXF → Chief Architect
**File → Import → Import Drawing (DWG, DXF)**.

The output is a CAD drawing, not a Chief Architect plan. Cabinets, walls, and appliances arrive
as linework; Chief Architect's CAD-to-Walls can convert some of it afterwards.

### Architecture

The portal runs on Render's **Node** runtime, which never executes a Dockerfile, so the
LibreDWG binary cannot live in the portal image. It runs in a second Render service built
from `converter/` (Docker runtime):

```
browser → portal /api/designer/cad-convert → cpr-cad-converter /convert → dwg2dxf
```

- The portal owns the designer session, the size limit, DWG header validation, filename
  sanitizing, job IDs, and all user-facing copy. It never shells out.
- The converter service accepts only requests carrying the shared `X-Converter-Token`,
  re-validates the payload, runs `dwg2dxf` with an argument list, and deletes its temp
  directory in a `finally` block. Neither side stores a drawing.
- `GET /api/designer/cad-convert` proxies the converter's health probe and returns a
  `detail` field naming the failure, so a broken deploy is diagnosable from the browser.

### The converter service (`converter/`)

Flask + gunicorn, with LibreDWG compiled from the pinned GNU tarball in a build stage. The
image runs `dwg2dxf --version` in the final stage, so a missing binary fails the build
instead of shipping a dead converter.

Run it locally:

```bash
cd converter
docker build -t cpr-cad-converter .
docker run -p 8080:8080 -e CONVERTER_TOKEN=dev-token cpr-cad-converter
curl localhost:8080/health
```

Point the portal at it with `CAD_CONVERTER_URL=http://localhost:8080` and
`CAD_CONVERTER_TOKEN=dev-token`.

### Configuration

Portal service:

| Variable | Default | Notes |
| --- | --- | --- |
| `CAD_CONVERTER_URL` | — | Base URL of the converter service, no trailing slash |
| `CAD_CONVERTER_TOKEN` | — | Must match `CONVERTER_TOKEN` on the converter |
| `MAX_UPLOAD_MB` | `25` | Application-level upload ceiling |
| `CONVERSION_TIMEOUT_SECONDS` | `60` | The portal waits 15s longer than this before giving up |

Converter service:

| Variable | Default | Notes |
| --- | --- | --- |
| `CONVERTER_TOKEN` | — | Required. Unset means every request is refused |
| `DXF_VERSION` | `r2013` | LibreDWG 0.13.3 accepts r12, r14, r2000, r2004, r2007, r2010, r2013. It lists r2018 as "planned" and rejects `--as r2018`, so R2013 is the newest usable target. Chief Architect X17 imports AutoCAD 2025 and earlier. |
| `MAX_UPLOAD_MB` | `25` | Second line of defence behind the portal's limit |
| `CONVERSION_TIMEOUT_SECONDS` | `60` | `dwg2dxf` subprocess timeout |

### Troubleshooting

Load `/api/designer/cad-convert` in the browser while signed in as a designer. The `detail`
field names the problem:

- `CAD_CONVERTER_URL missing` — the portal env vars were never set.
- `converter responded 503` — the binary is missing inside the converter image.
- `TimeoutError` — a free-tier converter instance was asleep. Retry; first wake takes ~50s.
- Bad scale after import: check a known dimension (island width, for example). Files not
  drawn 1:1 need a custom unit setting during import.
- Objects missing: `dwg2dxf` covers roughly 90% of DWG. External references and ACIS solids
  are not imported by Chief Architect regardless of the converter.

## Architecture

### Admin OAuth
1. Admin visits `/auth/login`
2. Zoho redirects to `/auth/callback`
3. Tokens stored in `zoho_tokens`

### Client Login
1. Admin sets a password at `/admin/login`
2. Client logs in at `/auth/client` using email + password
3. Successful login creates a session cookie

### Token Management
- Zoho admin tokens stored in Supabase (`zoho_tokens`)
- Client sessions stored in `client_sessions`

## Deployment Notes

- Hosting: Render
- Deploys from `main` (verify the latest commit is built in the Render dashboard).
- If changes do not appear, trigger a redeploy and hard refresh the browser.

## Resources

- Zoho CRM API Documentation
- Zoho OAuth 2.0 Guide
- SvelteKit Documentation

## License

Private - Custom Professional Renovations
