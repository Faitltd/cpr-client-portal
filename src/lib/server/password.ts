import { pbkdf2, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { env } from '$env/dynamic/private';
import { normalizeStoredPasswordHash } from './auth-normalization';

const pbkdf2Async = promisify(pbkdf2);
const PORTAL_PASSWORD_ITERATIONS = env.PORTAL_PASSWORD_ITERATIONS;
const DEFAULT_ITERATIONS = 100000;
const KEYLEN = 32;
const DIGEST = 'sha256';
const PREFIX = 'pbkdf2_sha256';

function getIterations() {
	const parsed = Number(PORTAL_PASSWORD_ITERATIONS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ITERATIONS;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	const iterations = getIterations();
	const hash = (await pbkdf2Async(password, salt, iterations, KEYLEN, DIGEST)).toString('hex');
	return `${PREFIX}$${iterations}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
	const normalizedStored = normalizeStoredPasswordHash(stored);
	if (!normalizedStored) return false;
	const parts = normalizedStored.split('$');
	if (parts.length !== 4) return false;
	const [prefix, iterationsRaw, salt, hash] = parts;
	if (prefix !== PREFIX) return false;
	const iterations = Number(iterationsRaw);
	if (!Number.isFinite(iterations) || iterations <= 0) return false;
	const candidate = (await pbkdf2Async(password, salt, iterations, KEYLEN, DIGEST)).toString('hex');
	try {
		return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
	} catch {
		return false;
	}
}
