import { env } from '$env/dynamic/private';

/**
 * Normalize an uploaded image to a Zoho-friendly, web-friendly JPEG.
 *
 * Why this exists:
 *  - iPhone HEIC / HEIF doesn't render in most browsers OR in Zoho's preview.
 *  - 4K phone photos are 4-12 MB each — bloat Supabase storage and slow the
 *    client dashboard's "Today on site" grid.
 *  - TIFF / BMP / uncommon formats trip up downstream Zoho viewers too.
 *
 * What it does per upload:
 *  - Decode any sharp-supported format (HEIC, JPEG, PNG, WebP, AVIF, TIFF,
 *    GIF, raw).
 *  - Resize so the long edge is at most MAX_DIM (default 2048 px).
 *  - Re-encode JPEG at QUALITY (default 82) progressive.
 *  - Strip EXIF (keep orientation rotation applied beforehand).
 *  - Generate a small thumbnail (default 400 px long edge, quality 70) for
 *    snappy grid rendering.
 *
 * Knobs (env vars):
 *  - IMAGE_NORMALIZE_MAX_DIM     (default 2048)
 *  - IMAGE_NORMALIZE_QUALITY     (default 82)
 *  - IMAGE_NORMALIZE_THUMB_DIM   (default 400)
 *  - IMAGE_NORMALIZE_THUMB_QUALITY (default 70)
 *
 * Skips:
 *  - Anything ≤ SKIP_BYTES threshold (default 250 KB) — already small.
 *  - Animated GIFs (sharp can encode them but quality is poor; pass-through).
 */

const MAX_DIM = Math.max(256, Number(env.IMAGE_NORMALIZE_MAX_DIM ?? '2048'));
const QUALITY = Math.min(100, Math.max(40, Number(env.IMAGE_NORMALIZE_QUALITY ?? '82')));
const THUMB_DIM = Math.max(120, Number(env.IMAGE_NORMALIZE_THUMB_DIM ?? '400'));
const THUMB_QUALITY = Math.min(100, Math.max(40, Number(env.IMAGE_NORMALIZE_THUMB_QUALITY ?? '70')));
const SKIP_BYTES = Math.max(0, Number(env.IMAGE_NORMALIZE_SKIP_BYTES ?? String(250 * 1024)));

export interface NormalizedImage {
	full: Buffer;
	thumb: Buffer;
	contentType: 'image/jpeg';
	ext: 'jpg';
	originalBytes: number;
	normalizedBytes: number;
	width: number;
	height: number;
	skipped: boolean;
	reason?: string;
}

const NORMALIZABLE_TYPES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/heic',
	'image/heif',
	'image/heic-sequence',
	'image/heif-sequence',
	'image/webp',
	'image/avif',
	'image/tiff',
	'image/bmp'
]);

const NORMALIZABLE_EXTS = new Set([
	'jpg',
	'jpeg',
	'png',
	'heic',
	'heif',
	'webp',
	'avif',
	'tif',
	'tiff',
	'bmp'
]);

export function shouldNormalize(file: { type?: string; name?: string; size?: number }): boolean {
	const ext = (file.name?.split('.').pop() ?? '').toLowerCase();
	const type = (file.type ?? '').toLowerCase();
	if (!type.startsWith('image/') && !NORMALIZABLE_EXTS.has(ext)) return false;
	// GIFs are usually animated — pass through.
	if (type === 'image/gif' || ext === 'gif') return false;
	// The small-file skip only applies to web-safe formats. HEIC/HEIF/TIFF/BMP/
	// AVIF must ALWAYS convert — browsers and Zoho Cliq can't render them at any
	// size, so a 200KB HEIC that skipped here showed up broken in Cliq cards.
	const alwaysConvertExts = new Set(['heic', 'heif', 'tif', 'tiff', 'bmp', 'avif']);
	const alwaysConvertTypes = new Set([
		'image/heic',
		'image/heif',
		'image/heic-sequence',
		'image/heif-sequence',
		'image/tiff',
		'image/bmp',
		'image/avif'
	]);
	const mustConvert = alwaysConvertExts.has(ext) || alwaysConvertTypes.has(type);
	if (!mustConvert && file.size != null && file.size <= SKIP_BYTES) return false;
	return NORMALIZABLE_TYPES.has(type) || NORMALIZABLE_EXTS.has(ext);
}

/**
 * iPhone HEIC files arrive in a format sharp's bundled libheif often can't
 * decode on Render's Node 22 binary (`No decoding plugin installed for this
 * compression format`). Detect by signature and pre-decode to JPEG via the
 * pure-JS heic-convert library, then hand that JPEG to sharp for the
 * resize / re-encode / thumbnail pipeline.
 */
function looksLikeHeic(buf: Buffer, fileName?: string): boolean {
	if (fileName) {
		const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
		if (ext === 'heic' || ext === 'heif') return true;
	}
	// ISO BMFF container; bytes 4-11 contain 'ftyp' + brand.
	if (buf.length < 12) return false;
	if (buf.slice(4, 8).toString('ascii') !== 'ftyp') return false;
	const brand = buf.slice(8, 12).toString('ascii').toLowerCase();
	return /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|hevm|hevs)/.test(brand);
}

async function decodeHeicToJpeg(buf: Buffer): Promise<Buffer> {
	const heicConvert = (await import('heic-convert')).default;
	const output = await heicConvert({
		buffer: buf,
		format: 'JPEG',
		quality: 0.95
	});
	return Buffer.from(output);
}

/**
 * Normalize a buffer. Throws on hard decode failure; the caller can fall
 * back to storing the original.
 */
export async function normalizeImage(buf: Buffer, fileName?: string): Promise<NormalizedImage> {
	const sharpMod = await import('sharp');
	const sharp = sharpMod.default;
	const originalBytes = buf.byteLength;

	// HEIC pre-pass — sharp's bundled libheif doesn't reliably support all
	// HEIC compression formats on Render. Convert to JPEG first.
	let workingBuf = buf;
	if (looksLikeHeic(buf, fileName)) {
		try {
			workingBuf = await decodeHeicToJpeg(buf);
		} catch (err) {
			// If heic-convert fails too, let sharp try one more time (some
			// "HEIC" files are actually JPEG with wrong extension).
			console.warn(
				'[image-normalizer] heic-convert failed, falling back to sharp:',
				err instanceof Error ? err.message : err
			);
		}
	}

	// First pass: read metadata to know orientation + dimensions.
	const image = sharp(workingBuf, { failOn: 'none' }).rotate(); // applies EXIF orientation
	const meta = await image.metadata();

	const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
	const needsResize = longEdge > MAX_DIM;

	const pipeline = needsResize
		? image.resize({
				width: MAX_DIM,
				height: MAX_DIM,
				fit: 'inside',
				withoutEnlargement: true
			})
		: image;

	const full = await pipeline
		.jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
		.toBuffer();

	const thumb = await sharp(full)
		.resize({
			width: THUMB_DIM,
			height: THUMB_DIM,
			fit: 'inside',
			withoutEnlargement: true
		})
		.jpeg({ quality: THUMB_QUALITY, progressive: true, mozjpeg: true })
		.toBuffer();

	const fullMeta = await sharp(full).metadata();
	return {
		full,
		thumb,
		contentType: 'image/jpeg',
		ext: 'jpg',
		originalBytes,
		normalizedBytes: full.byteLength,
		width: fullMeta.width ?? 0,
		height: fullMeta.height ?? 0,
		skipped: false
	};
}
