// @ts-ignore
import GIF from 'gif.js';

function loadImage(blob: Blob): Promise<HTMLImageElement> {
	return new Promise((res, rej) => {
		if (!blob) {
			rej(new Error('missing image blob'));
			return;
		}
		const img = new Image();
		const url = URL.createObjectURL(blob);
		img.onload = () => res(img);
		img.onerror = () => rej(new Error('image failed to load'));
		img.src = url;
	});
}

export async function exportGif(
	before: Blob,
	after: Blob,
	mode: 'dissolve' | 'slide' = 'dissolve'
) {
	try {
		if (!before || !after) {
			alert('This pair is missing a photo. Delete it and shoot a new one.');
			return;
		}

		const b = await loadImage(before);
		const a = await loadImage(after);

		// Resolution cap. Higher = sharper GIF; paired with an adaptive
		// frame count below so total memory stays bounded on mobile Safari.
		const MAX = 1000;
		const scale = Math.min(1, MAX / Math.max(b.naturalWidth, b.naturalHeight));
		const w = Math.round(b.naturalWidth * scale);
		const h = Math.round(b.naturalHeight * scale);

		if (!w || !h) {
			alert('Could not read photo size (' + b.naturalWidth + 'x' + b.naturalHeight + ').');
			return;
		}

		// Keep total decoded frame memory ~<= BUDGET_MP megapixels (~4 bytes each),
		// so a bigger image simply uses fewer transition steps instead of crashing.
		const BUDGET_MP = 20;
		const framesMax = Math.floor((BUDGET_MP * 1e6) / (w * h));
		const STEPS = Math.max(4, Math.min(12, Math.floor((framesMax - 1) / 2)));

		const gif = new GIF({
			workers: 2,
			quality: 5, // lower = better color/dithering
			workerScript: '/gif.worker.js',
			width: w,
			height: h
		});

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d')!;

		const HOLD = 1200;
		const FRAME = 60;

		function drawDissolve(t: number) {
			ctx.clearRect(0, 0, w, h);
			ctx.globalAlpha = 1;
			ctx.drawImage(b, 0, 0, w, h);
			ctx.globalAlpha = t;
			ctx.drawImage(a, 0, 0, w, h);
			ctx.globalAlpha = 1;
		}

		function drawSlide(t: number) {
			ctx.clearRect(0, 0, w, h);
			ctx.drawImage(b, 0, 0, w, h);
			const x = Math.round(w * t);
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, x, h);
			ctx.clip();
			ctx.drawImage(a, 0, 0, w, h);
			ctx.restore();
			if (x > 0 && x < w) {
				ctx.fillStyle = '#fff';
				ctx.fillRect(x - 1, 0, 2, h);
			}
		}

		const draw = mode === 'slide' ? drawSlide : drawDissolve;

		draw(0);
		gif.addFrame(ctx, { copy: true, delay: HOLD });
		for (let i = 1; i <= STEPS; i++) {
			draw(i / STEPS);
			gif.addFrame(ctx, { copy: true, delay: FRAME });
		}
		draw(1);
		gif.addFrame(ctx, { copy: true, delay: HOLD });
		for (let i = STEPS - 1; i >= 1; i--) {
			draw(i / STEPS);
			gif.addFrame(ctx, { copy: true, delay: FRAME });
		}

		gif.on('finished', (blob: Blob) => {
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `beforeafter-${mode}.gif`;
			link.click();
			URL.revokeObjectURL(url);
		});
		// @ts-ignore
		gif.on('abort', () => alert('GIF encoding was aborted (likely out of memory).'));

		gif.render();
	} catch (err) {
		alert('GIF error: ' + (err instanceof Error ? err.message : String(err)));
	}
}
