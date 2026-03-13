import { env } from '$env/dynamic/private';
import { findContactByEmail, getContactDeals, isPortalActiveStage } from './auth';
import { getZohoTokens, upsertZohoTokens } from './db';
import { refreshAccessToken, zohoApiCall } from './zoho';
import { createLogger } from '$lib/server/logger';

const log = createLogger('projects');