import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_CLIENT_ID = env.ZOHO_CLIENT_ID || '';
const ZOHO_AUTH_URL = env.ZOHO_AUTH_URL || '';
const ZOHO_REDIRECT_URI = env.ZOHO_REDIRECT_URI || '';
const ZOHO_SCOPE = env.ZOHO_SCOPE || '';

// Keep the auth request on a known-good scope set. One invalid scope token causes Zoho to reject
// the full OAuth request with "Scope does not exist".
const REQUIRED_ZOHO_SCOPES = [
	'ZohoCRM.modules.ALL',
	'ZohoCRM.settings.ALL',
	'ZohoCRM.org.ALL',
	'ZohoCRM.users.READ',
	'ZohoCRM.coql.READ',
	'ZohoProjects.portals.READ',
	'ZohoProjects.projects.READ',
	'ZohoProjects.tasks.READ',
	'ZohoProjects.tasklists.READ',
	'ZohoProjects.milestones.READ',
	'ZohoProjects.users.READ',
	'WorkDrive.team.ALL',
	'WorkDrive.workspace.ALL',
	'WorkDrive.files.ALL',
	'WorkDrive.organization.READ',
	'WorkDrive.teamfolders.ALL',
	'ZohoFiles.files.READ'
] as const;

const OPTIONAL_ZOHO_SCOPES = ['ZohoBooks.fullaccess.ALL', 'ZohoSign.documents.ALL'] as const;

const ALLOWED_ZOHO_SCOPES = new Set<string>([...REQUIRED_ZOHO_SCOPES, ...OPTIONAL_ZOHO_SCOPES]);

function tokenizeZohoScope(scope: string) {
	const trimmed = scope.trim();

	// Some env UIs include surrounding quotes in the value; strip a single pair if present.
	const unquoted =
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
			? trimmed.slice(1, -1)
			: trimmed;

	return unquoted
		.split(/[\s,]+/g)
		.map((value) => value.trim())
		.filter(Boolean);
}

function normalizeZohoScope(scope: string) {
	const raw = tokenizeZohoScope(scope);
	const filtered = raw.filter((token) => ALLOWED_ZOHO_SCOPES.has(token));
	const ignored = raw.filter((token) => !ALLOWED_ZOHO_SCOPES.has(token));

	if (ignored.length > 0) {
		console.warn('Ignoring unsupported Zoho scopes from ZOHO_SCOPE:', ignored);
	}

	const result: string[] = [];
	const seen = new Set<string>();
	for (const token of [...filtered, ...REQUIRED_ZOHO_SCOPES]) {
		if (seen.has(token)) continue;
		seen.add(token);
		result.push(token);
	}

	return result.join(',');
}

export const GET: RequestHandler = async () => {
	const params = new URLSearchParams({
		scope: normalizeZohoScope(ZOHO_SCOPE),
		client_id: ZOHO_CLIENT_ID,
		response_type: 'code',
		access_type: 'offline',
		redirect_uri: ZOHO_REDIRECT_URI,
		prompt: 'consent'
	});

	const authUrl = `${ZOHO_AUTH_URL}?${params.toString()}`;
	throw redirect(302, authUrl);
};
