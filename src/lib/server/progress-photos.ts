const LINK_VALIDATION_TTL_MS = 5 * 60 * 1000;
const LINK_VALIDATION_TIMEOUT_MS = 7000;

type ValidationCacheEntry = {
	checkedAt: number;
	ok: boolean;
};

const linkValidationCache = new Map<string, ValidationCacheEntry>();

function toUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		return trimmed;
	} catch {
		return null;
	}
}

function extractUrlsFromText(value: string): string[] {
	const matches = value.match(/https?:\/\/[^\s"'<>]+/gi) || [];
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const match of matches) {
		const normalized = toUrl(match);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		urls.push(normalized);
	}
	return urls;
}

function collectUrls(value: unknown, output: string[], depth = 0) {
	if (depth > 3 || value === null || value === undefined) return;

	if (typeof value === 'string') {
		const url = toUrl(value);
		if (url) {
			output.push(url);
			return;
		}
		for (const extracted of extractUrlsFromText(value)) output.push(extracted);
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) collectUrls(item, output, depth + 1);
		return;
	}

	if (typeof value !== 'object') return;
	const record = value as Record<string, unknown>;
	const preferredKeys = [
		'link_url',
		'link',
		'download_url',
		'url',
		'href',
		'File_Url',
		'File_URL',
		'file_url',
		'fileUrl',
		'external_url',
		'permalink',
		'value',
		'display_value'
	];

	for (const key of preferredKeys) {
		if (!(key in record)) continue;
		collectUrls(record[key], output, depth + 1);
	}

	for (const nested of Object.values(record)) {
		if (typeof nested === 'string') {
			const url = toUrl(nested);
			if (url) {
				output.push(url);
				continue;
			}
			for (const extracted of extractUrlsFromText(nested)) output.push(extracted);
			continue;
		}
		if (!nested || typeof nested !== 'object') continue;
		collectUrls(nested, output, depth + 1);
	}
}

export function getProgressPhotosLinkCandidates(deal: any): string[] {
	const values = [deal?.Client_Portal_Folder, deal?.Progress_Photos, deal?.External_Link];
	const collected: string[] = [];
	for (const value of values) {
		collectUrls(value, collected);
	}
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const candidate of collected) {
		if (!candidate || seen.has(candidate)) continue;
		seen.add(candidate);
		deduped.push(candidate);
	}
	return deduped;
}

function scoreCandidate(url: string) {
	const text = String(url || '').toLowerCase();
	let score = 0;
	if (text.includes('workdrive')) score += 30;
	if (text.includes('/folder/')) score += 20;
	if (text.includes('client')) score += 10;
	if (text.includes('photo')) score += 8;
	if (text.includes('external_link')) score -= 10;
	return score;
}

export function pickBestProgressPhotosFallback(candidates: string[]): string {
	if (!Array.isArray(candidates) || candidates.length === 0) return '';
	return [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0] || '';
}

function looksLikeInvalidLinkPage(html: string) {
	const text = html.toLowerCase();
	return (
		text.includes('this link is no longer valid') ||
		text.includes('the link may have expired') ||
		text.includes('learn more about invalid links')
	);
}

async function isLinkReachable(url: string): Promise<boolean> {
	const cached = linkValidationCache.get(url);
	if (cached && Date.now() - cached.checkedAt < LINK_VALIDATION_TTL_MS) {
		return cached.ok;
	}

	let ok = false;
	try {
		const res = await fetch(url, {
			method: 'GET',
			redirect: 'follow',
			signal: AbortSignal.timeout(LINK_VALIDATION_TIMEOUT_MS)
		});
		if (!res.ok) {
			ok = false;
		} else {
			const contentType = (res.headers.get('content-type') || '').toLowerCase();
			if (contentType.includes('text/html')) {
				const body = await res.text();
				ok = !looksLikeInvalidLinkPage(body);
			} else {
				ok = true;
			}
		}
	} catch {
		// Network checks can fail due remote throttling; keep candidate usable.
		ok = true;
	}

	linkValidationCache.set(url, { checkedAt: Date.now(), ok });
	return ok;
}

export async function resolveProgressPhotosLink(deal: any): Promise<string | null> {
	const candidates = getProgressPhotosLinkCandidates(deal);
	if (candidates.length === 0) return null;

	for (const candidate of candidates) {
		const reachable = await isLinkReachable(candidate);
		if (reachable) return candidate;
	}

	return null;
}
