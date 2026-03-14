import { env } from '$env/dynamic/private';
import type { Handle, HandleServerError } from '@sveltejs/kit';

const DEFAULT_CANONICAL_URL = 'https://portal.homecpr.pro';
const DEFAULT_LEGACY_HOSTS = ['cpr-client-portal.onrender.com'];

function normalizeHostList(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function toUrl(value: string | undefined, fallback: string): URL {
	const raw = (value || fallback).trim();
	const normalized = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
	return new URL(normalized);
}

function getRequestHost(request: Request, url: URL) {
	const forwardedHost = request.headers
		.get('x-forwarded-host')
		?.split(',')[0]
		?.trim()
		?.toLowerCase();
	if (forwardedHost) return forwardedHost;

	const host = request.headers.get('host')?.trim()?.toLowerCase();
	if (host) return host;

	return url.host.toLowerCase();
}

export const handle: Handle = async ({ event, resolve }) => {
	const canonicalUrl = toUrl(env.PORTAL_BASE_URL || env.ZOHO_SIGN_HOST, DEFAULT_CANONICAL_URL);
	const legacyHosts = new Set([
		...DEFAULT_LEGACY_HOSTS,
		...normalizeHostList(env.PORTAL_LEGACY_HOSTS)
	]);

	const requestHost = getRequestHost(event.request, event.url);
	if (legacyHosts.has(requestHost) && requestHost !== canonicalUrl.host.toLowerCase()) {
		const redirectUrl = new URL(`${event.url.pathname}${event.url.search}`, canonicalUrl);
		return Response.redirect(redirectUrl.toString(), 308);
	}

	try {
		return await resolve(event);
	} catch (err) {
		// If an API route throws an unhandled error, return JSON instead of HTML error page.
		// SvelteKit may render its HTML error page for unexpected throws, which causes
		// 'Unexpected token <' errors on the client when it tries to JSON.parse the response.
		if (event.url.pathname.startsWith('/api/')) {
			console.error(`[hooks] Unhandled API error on ${event.url.pathname}:`, err);
			const message = err instanceof Error ? err.message : 'Internal server error';
			return new Response(JSON.stringify({ message }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		throw err;
	}
};

/** Ensure unexpected errors always produce JSON for API routes. */
export const handleError: HandleServerError = ({ error, event }) => {
	console.error(`[handleError] ${event.url.pathname}:`, error);
	const message = error instanceof Error ? error.message : 'Internal server error';
	return { message };
};
