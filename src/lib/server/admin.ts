import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '$env/dynamic/private';

const PORTAL_ADMIN_PASSWORD = env.PORTAL_ADMIN_PASSWORD || '';
const PORTAL_ADMIN_SESSION_TTL_HOURS = env.PORTAL_ADMIN_SESSION_TTL_HOURS;
const SESSION_SECRET = env.SESSION_SECRET || '';

const DEFAULT_TTL_HOURS = 12;

function getTtlHours() {
	const parsed = Number(PORTAL_ADMIN_SESSION_TTL_HOURS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

function sign(value: string) {
	return createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

export function isAdminConfigured() {
	return Boolean(SESSION_SECRET && PORTAL_ADMIN_PASSWORD);
}

export function getAdminSessionMaxAge() {
	return getTtlHours() * 60 * 60;
}

export function createAdminSession() {
	if (!isAdminConfigured()) {
		throw new Error('Admin auth not configured');
	}
	const ts = Date.now().toString();
	const payload = `${ts}.${PORTAL_ADMIN_PASSWORD}`;
	const sig = sign(payload);
	return `${ts}.${sig}`;
}

export function isValidAdminSession(cookieValue?: string | null) {
	if (!cookieValue || !isAdminConfigured()) return false;
	const parts = cookieValue.split('.');
	if (parts.length !== 2) return false;
	const [ts, sig] = parts;
	if (!/^\d+$/.test(ts)) return false;

	const ageMs = Date.now() - Number(ts);
	if (ageMs < 0) return false;
	if (ageMs > getTtlHours() * 60 * 60 * 1000) return false;

	const payload = `${ts}.${PORTAL_ADMIN_PASSWORD}`;
	const expected = sign(payload);

	try {
		return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
	} catch {
		return false;
	}
}
