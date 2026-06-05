import OpenAI from 'openai';
import { env } from '$env/dynamic/private';

/**
 * OCR a PDF buffer using OpenAI Vision (gpt-4o-mini).
 *
 * Renders each PDF page to a PNG, sends it to the chat completions API as an
 * image input, and asks the model to transcribe the text. Concatenates the
 * per-page transcriptions and returns the result.
 *
 * Cost: ~$0.001-0.005 per page on gpt-4o-mini (image input is ~$0.00015 per
 * tile + ~$0.0006 per 1k output tokens). For typical CPR project scopes
 * (1-5 pages, ~500 words each) this is well under a penny per file.
 *
 * Render hosting note: pdf-to-img bundles pdfjs-dist + canvas (via
 * @napi-rs/canvas) so no GraphicsMagick / Poppler install is needed.
 */

const OCR_MODEL = env.BOT_OCR_MODEL || 'gpt-4o-mini';
const MAX_PAGES = Number(env.BOT_OCR_MAX_PAGES ?? '8');

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
	if (openaiClient) return openaiClient;
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) throw new Error('OPENAI_API_KEY not set');
	openaiClient = new OpenAI({ apiKey });
	return openaiClient;
}

async function renderPdfPagesToPng(buf: Buffer): Promise<Buffer[]> {
	// pdf-to-img is ESM-only and dynamic-imported to keep cold-start lean.
	const { pdf } = await import('pdf-to-img');
	const document = await pdf(buf, { scale: 2 });
	const pages: Buffer[] = [];
	for await (const pageBuf of document) {
		pages.push(pageBuf as Buffer);
		if (pages.length >= MAX_PAGES) break;
	}
	return pages;
}

async function transcribeImage(pageBuf: Buffer, pageIndex: number, total: number): Promise<string> {
	const openai = getOpenAI();
	const dataUrl = `data:image/png;base64,${pageBuf.toString('base64')}`;
	const response = await openai.chat.completions.create({
		model: OCR_MODEL,
		temperature: 0,
		messages: [
			{
				role: 'system',
				content:
					'You transcribe scanned documents into plain text. Preserve original line breaks, headings, bullet lists, and tables (use simple ASCII columns). Do not summarise. Do not add commentary. If the page is blank, reply with exactly: [blank page]'
			},
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: `Transcribe page ${pageIndex + 1} of ${total} from this scanned PDF.`
					},
					{ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
				]
			}
		]
	});
	const text = response.choices?.[0]?.message?.content ?? '';
	return typeof text === 'string' ? text.trim() : '';
}

/**
 * OCR the entire PDF and return a single concatenated string. Each page is
 * prefixed with a header "## Page N" so the bot can cite page numbers.
 */
export async function ocrPdfBufferWithOpenAI(buf: Buffer): Promise<string> {
	let pages: Buffer[];
	try {
		pages = await renderPdfPagesToPng(buf);
	} catch (err) {
		console.warn(
			'[bot/ocr] PDF render failed:',
			err instanceof Error ? err.message : err
		);
		return '';
	}
	if (pages.length === 0) return '';

	const transcripts: string[] = [];
	for (let i = 0; i < pages.length; i += 1) {
		try {
			const text = await transcribeImage(pages[i], i, pages.length);
			if (text && text !== '[blank page]') {
				transcripts.push(`## Page ${i + 1}\n${text}`);
			}
		} catch (err) {
			console.warn(
				`[bot/ocr] page ${i + 1} OCR failed:`,
				err instanceof Error ? err.message : err
			);
		}
	}
	return transcripts.join('\n\n');
}
