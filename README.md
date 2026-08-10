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

### How it works

- Conversion engine: GNU LibreDWG `dwg2dxf`, compiled from the pinned GNU tarball in the
  `libredwg` stage of the `Dockerfile` (Alpine has no libredwg package). Bump `LIBREDWG_VERSION`
  to upgrade; the image build fails if the compile or `dwg2dxf --version` fails.
- Endpoint: `POST /api/designer/cad-convert` (multipart, field `file`) returns the DXF as a
  download. `GET` on the same path is a health probe reporting converter availability.
- Uploads are validated by extension, size, and DWG header bytes, written to a random temp
  directory, converted with an argument array (never a shell string), and the directory is
  removed in a `finally` block. Nothing is stored.
- Failures return plain-language copy plus a job reference like `CAD-7F39A21C`; LibreDWG exit
  codes and stderr go to the server log only.

### Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DXF_VERSION` | `r2018` | One of r12, r14, r2000, r2004, r2007, r2010, r2013, r2018 |
| `MAX_UPLOAD_MB` | `25` | Application-level upload ceiling |
| `CONVERSION_TIMEOUT_SECONDS` | `60` | Must stay below the platform request timeout |
| `DWG2DXF_PATH` | `dwg2dxf` | Override only if the binary is not on `PATH` |

### Troubleshooting

- Converter reported unavailable: shell into the Render instance and run
  `dwg2dxf --version`. Missing binary means the `libredwg` build stage did not run.
- Bad scale after import: check a known dimension (island width, for example) in Chief
  Architect. Files not drawn 1:1 need a custom unit setting during import.
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
