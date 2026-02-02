import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { PORTAL_PASSWORD_ITERATIONS } from '$env/static/private';

const DEFAULT_ITERATIONS = 210000;
const KEYLEN = 32;
const DIGEST = 'sha256';
const PREFIX = 'pbkdf2_sha256';

function getIterations() {
	const parsed = Number(PORTAL_PASSWORD_ITERATIONS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ITERATIONS;
}

export function hashPassword(password: string) {
	const salt = randomBytes(16).toString('hex');
	const iterations = getIterations();
	const hash = pbkdf2Sync(password, salt, iterations, KEYLEN, DIGEST).toString('hex');
	return `${PREFIX}$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null) {
	if (!stored) return false;
	const parts = stored.split('$');
	if (parts.length !== 4) return false;

	const [prefix, iterationsRaw, salt, hash] = parts;
	if (prefix !== PREFIX) return false;
	const iterations = Number(iterationsRaw);
	if (!Number.isFinite(iterations) || iterations <= 0) return false;

	const candidate = pbkdf2Sync(password, salt, iterations, KEYLEN, DIGEST).toString('hex');
	try {
		return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
	} catch {
		return false;
	}
}
