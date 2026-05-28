import OpenAI from 'openai';
import { env } from '$env/dynamic/private';

const EMBED_MODEL = env.BOT_EMBED_MODEL || 'text-embedding-3-small';
const EMBED_DIMS = 1536;
const BATCH_SIZE = 96;

let client: OpenAI | null = null;
function getOpenAI(): OpenAI {
	if (client) return client;
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) throw new Error('OPENAI_API_KEY not set');
	client = new OpenAI({ apiKey });
	return client;
}

/**
 * Embed a batch of strings. Returns one vector per input, preserving order.
 * Empty strings become zero vectors so callers can keep their index alignment.
 */
export async function embed(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const out: number[][] = new Array(texts.length);
	const indices: number[] = [];
	const inputs: string[] = [];
	for (let i = 0; i < texts.length; i++) {
		const t = (texts[i] ?? '').trim();
		if (!t) {
			out[i] = new Array(EMBED_DIMS).fill(0);
		} else {
			indices.push(i);
			inputs.push(t);
		}
	}

	const openai = getOpenAI();
	for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
		const slice = inputs.slice(i, i + BATCH_SIZE);
		const res = await openai.embeddings.create({
			model: EMBED_MODEL,
			input: slice
		});
		for (let j = 0; j < res.data.length; j++) {
			out[indices[i + j]] = res.data[j].embedding;
		}
	}
	return out;
}

/**
 * Split text into overlapping chunks ~`size` chars long with `overlap`-char
 * tails. Cheap char-based chunking; good enough for Cliq messages and emails.
 */
export function chunkText(text: string, size = 1200, overlap = 160): string[] {
	const cleaned = text.replace(/\s+/g, ' ').trim();
	if (!cleaned) return [];
	if (cleaned.length <= size) return [cleaned];

	const chunks: string[] = [];
	let start = 0;
	while (start < cleaned.length) {
		const end = Math.min(start + size, cleaned.length);
		chunks.push(cleaned.slice(start, end));
		if (end === cleaned.length) break;
		start = end - overlap;
	}
	return chunks;
}
