export function normalizeEmailAddress(value: string | null | undefined): string {
	if (typeof value !== 'string') return '';
	return value.trim().toLowerCase();
}

export function normalizeStoredPasswordHash(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed || null;
}

export function findNormalizedEmailMatch<T extends { email: string | null | undefined }>(
	records: T[] | null | undefined,
	email: string
): T | null {
	const normalizedEmail = normalizeEmailAddress(email);
	if (!normalizedEmail) return null;

	const matches = (records ?? []).filter(
		(record) => normalizeEmailAddress(record.email) === normalizedEmail
	);

	if (matches.length === 0) return null;
	if (matches.length > 1) {
		throw new Error(`Multiple records matched normalized email ${normalizedEmail}`);
	}

	return matches[0];
}
