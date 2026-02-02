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
   - Required Scopes: `ZohoCRM.modules.contacts.READ,ZohoCRM.modules.deals.READ,ZohoCRM.modules.deals.UPDATE,ZohoCRM.modules.Attachments.READ,ZohoCRM.users.READ`

5. Update `.env` with your credentials:
   - `ZOHO_CLIENT_ID`
   - `ZOHO_CLIENT_SECRET`
   - `ZOHO_REDIRECT_URI`
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

9. Client login:
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

## Resources

- Zoho CRM API Documentation
- Zoho OAuth 2.0 Guide
- SvelteKit Documentation

## License

Private - Custom Professional Renovations
