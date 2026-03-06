# cliq-service

A Node.js/TypeScript bridge service that connects the CPR Renovations client portal to Zoho Cliq. It exposes an authenticated REST + WebSocket API so portal users can send and receive project-scoped chat messages in real time, while team members communicate from inside Zoho Cliq. An SQLite database acts as a local message cache to reduce Cliq API calls and enable instant history loads.

## Architecture

```
Portal (React)
    │  JWT auth
    │  POST /api/chat/send
    │  GET  /api/chat/history/:slug
    │  WS   socket.io
    ▼
cliq-service  (Express + Socket.IO)
    │  axios  OAuth2 refresh token
    ▼
Zoho Cliq API
    (channels, messages)
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ZOHO_CLIENT_ID` | yes | — | OAuth2 client ID from the Zoho API Console |
| `ZOHO_CLIENT_SECRET` | yes | — | OAuth2 client secret |
| `ZOHO_REFRESH_TOKEN` | yes | — | Long-lived refresh token used to obtain access tokens |
| `ZOHO_API_DOMAIN` | yes | — | Zoho API base URL (use `https://www.zohoapis.com`) |
| `JWT_SECRET` | yes | — | Secret used to verify portal-issued JWTs |
| `PORT` | no | `3001` | Port the HTTP server listens on |
| `ALLOWED_ORIGINS` | no | `""` (all) | Comma-separated list of allowed CORS origins |
| `ALLOW_CHANNEL_CREATE` | no | `false` | When `true`, `ensureChannel` will create a missing Cliq channel; when `false` it throws instead |
| `SQLITE_DB_PATH` | no | `./data/messages.db` | Filesystem path for the SQLite message cache |
| `POLL_INTERVAL_MS` | no | `5000` | Milliseconds between Cliq poll cycles for WebSocket push |
| `POLL_HISTORY_LIMIT` | no | `20` | Number of recent messages fetched from Cliq per poll cycle |

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Create and fill in your secrets
cp .env.example .env
#    ZOHO_CLIENT_ID=...
#    ZOHO_CLIENT_SECRET=...
#    ZOHO_REFRESH_TOKEN=...
#    ZOHO_API_DOMAIN=https://www.zohoapis.com
#    JWT_SECRET=...

# 3. Start the dev server (ts-node-dev, auto-restarts on changes)
npm run dev
```

The service will be available at `http://localhost:3001`.

## Docker (local)

Requires Docker and Docker Compose. The SQLite database is persisted in `./data/` in the project root.

```bash
docker-compose up --build
```

- cliq-bridge: `http://localhost:3001`
- cliq-frontend: `http://localhost:5173`

## Deploy to Cloud Run

### Prerequisites — create secrets in Secret Manager once

```bash
for SECRET in zoho-client-id zoho-client-secret zoho-refresh-token jwt-secret; do
  gcloud secrets create $SECRET --replication-policy=automatic
done

echo -n "YOUR_VALUE" | gcloud secrets versions add zoho-client-id    --data-file=-
echo -n "YOUR_VALUE" | gcloud secrets versions add zoho-client-secret --data-file=-
echo -n "YOUR_VALUE" | gcloud secrets versions add zoho-refresh-token --data-file=-
echo -n "YOUR_VALUE" | gcloud secrets versions add jwt-secret         --data-file=-
```

Also grant the Cloud Run service account access:

```bash
SA="$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
for SECRET in zoho-client-id zoho-client-secret zoho-refresh-token jwt-secret; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
done
```

### Submit a build and deploy

```bash
gcloud builds submit --config=cloudbuild.yaml
```

Cloud Build will build the image, push it to GCR, and deploy to Cloud Run with session affinity enabled (required for Socket.IO).

> **SQLite on Cloud Run:** Cloud Run instances are ephemeral. For persistent storage mount a Cloud Storage bucket via GCS FUSE (`run.googleapis.com/execution-environment: gen2` + a `csi` volume in `service.yaml`). With `--max-instances=3` and a shared GCS mount, SQLite WAL mode handles concurrent reads; writes are serialized by the service logic.

## Testing

### Manual smoke test

```bash
npm run test:manual
```

### curl examples

Health check (no auth required):

```bash
curl https://YOUR_SERVICE_URL/api/health
# {"status":"ok"}
```

Debug a project channel (requires a valid portal JWT):

```bash
curl -H "Authorization: Bearer YOUR_JWT" \
     -H "X-Project-Slug: test" \
     https://YOUR_SERVICE_URL/api/chat/debug/test
# {
#   "correlationId": "...",
#   "channelName": "cpr-test",
#   "channelCreated": false,
#   "messages": [...]
# }
```

## Incident playbook — "I sent a message but nobody sees it in Cliq"

1. **Get the `projectSlug`** from the client's portal URL (e.g. `my-kitchen-reno`).

2. **Call the debug endpoint** to capture the full picture:
   ```bash
   curl -H "Authorization: Bearer ADMIN_JWT" \
        https://YOUR_SERVICE_URL/api/chat/debug/my-kitchen-reno
   ```
   Note the `correlationId`, `channelCreated`, and `messages` in the response.

3. **Search Cloud Logging** for that `correlationId`:
   ```
   resource.type="cloud_run_revision"
   textPayload=~"CORRELATION_ID"
   ```

4. **Did Zoho return 200?**
   Look for `postClientMessage failed` or a non-2xx status logged against the correlationId. A 401 means the refresh token has expired — rotate it in Secret Manager and redeploy.

5. **Did `ensureChannel` find the channel?**
   If `channelCreated: false` and the channel doesn't exist in Cliq, and `ALLOW_CHANNEL_CREATE=false`, the send call is throwing before it reaches Cliq. Set `ALLOW_CHANNEL_CREATE=true` temporarily or create the channel in Cliq manually.

6. **Is the refresh token still valid?**
   Search logs for `401` responses to `https://accounts.zoho.com/oauth/v2/token`. If present, generate a new refresh token from the Zoho API Console and update the `zoho-refresh-token` secret.

7. **Is SQLite writable?**
   Search logs for `SQLITE_` error codes. If the `/app/data` directory is not mounted or the process lacks write permission, messages will still be forwarded to Cliq but the local cache will fail. Check the volume mount and file permissions.

## Rate limits

Zoho allows approximately **100 requests per minute** per OAuth client.

The poller fires once every `POLL_INTERVAL_MS` ms **per active channel**. With *N* channels:

```
requests/min = (60_000 / POLL_INTERVAL_MS) × N
```

Example: 5 s interval, 6 channels → 12 × 6 = **72 req/min** (safe).
Keep utilisation under **80 req/min** to leave headroom for send/history calls.
If you exceed this, increase `POLL_INTERVAL_MS` or reduce `POLL_HISTORY_LIMIT`.
