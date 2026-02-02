# CPR Client Portal

Custom client portal for Custom Professional Renovations built with SvelteKit and Zoho CRM API integration.

## Features

- OAuth 2.0 authentication with Zoho CRM
- Real-time project/deal access from Zoho CRM
- Secure token management with refresh capability
- Custom branded UI without Zoho portal constraints
- Integration-ready for Zoho Books, Sign, and Projects

## Getting Started

### Prerequisites

- Node.js 20+
- Zoho CRM account with API access
- Zoho Developer Console application configured

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

4. Register your application in [Zoho Developer Console](https://api-console.zoho.com/):
   - Application Type: Server-based
   - Authorized Redirect URI: `http://localhost:5173/auth/callback` (development)
   - Required Scopes: `ZohoCRM.modules.contacts.READ,ZohoCRM.modules.deals.READ,ZohoCRM.modules.deals.UPDATE,ZohoCRM.modules.Attachments.READ`

5. Update `.env` with your Zoho credentials:
   - `ZOHO_CLIENT_ID`: Your Client ID from Zoho Developer Console
   - `ZOHO_CLIENT_SECRET`: Your Client Secret
   - `ZOHO_REDIRECT_URI`: Must match registered redirect URI

6. Run development server:
```bash
npm run dev
```

7. Visit `http://localhost:5173` and test OAuth flow

## Architecture

### OAuth Flow
1. Client clicks "Login" → `/auth/login`
2. Redirects to Zoho OAuth with scopes
3. User authorizes → Zoho redirects to `/auth/callback` with code
4. Exchange code for access + refresh tokens
5. Store tokens securely (HTTP-only cookies)
6. Access portal with authenticated API calls

### API Routes
- `/auth/login` - Initiates OAuth flow
- `/auth/callback` - Handles OAuth callback and token exchange
- `/api/projects` - Fetches client deals from Zoho CRM
- `/api/documents` - TODO: Retrieve attachments
- `/api/timeline` - TODO: Pull notes and tasks

### Token Management
- Access tokens stored in HTTP-only cookies (1 hour expiry)
- Refresh tokens stored separately (30 day expiry)
- Automatic token refresh on API call failures
- TODO: Move to Supabase for persistent storage

## Deployment

### Docker Build
```bash
docker build -t cpr-portal .
docker run -p 3000:3000 --env-file .env cpr-portal
```

### Cloud Run Deployment
1. Update redirect URI in Zoho Console to production domain
2. Configure production environment variables
3. Deploy via GitHub Actions or manual push

## Next Steps

- [ ] Implement Supabase integration for token storage
- [ ] Add document/attachment retrieval endpoint
- [ ] Build project detail page with timeline
- [ ] Integrate Zoho Sign for contract viewing
- [ ] Add photo gallery for progress images
- [ ] Implement change order request workflow
- [ ] Setup production domain (portal.customprofreno.com)
- [ ] Configure GitHub Actions for automated deployment

## Resources

- [Zoho CRM API Documentation](https://www.zoho.com/crm/developer/docs/api/v8/)
- [Zoho OAuth 2.0 Guide](https://www.zoho.com/accounts/protocol/oauth.html)
- [SvelteKit Documentation](https://kit.svelte.dev/docs)

## License

Private - Custom Professional Renovations