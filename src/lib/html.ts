export function decodeHtmlEntities(value: string | null | undefined): string {
	if (!value) return '';
	if (typeof window === 'undefined') {
		return value
			.replace(/&#(\d+);/g, (_, code) => {
				const parsed = Number.parseInt(code, 10);
				return Number.isNaN(parsed) ? _ : String.fromCodePoint(parsed);
			})
			.replace(/&#x([\da-f]+);/gi, (_, code) => {
				const parsed = Number.parseInt(code, 16);
				return Number.isNaN(parsed) ? _ : String.fromCodePoint(parsed);
			})
			.replace(/&quot;/g, '"')
			.replace(/&#39;|&apos;/g, "'")
			.replace(/&nbsp;/g, ' ')
			.replace(/&bull;|&middot;/g, '-')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
	}

	const div = document.createElement('div');
	div.innerHTML = value;
	return div.textContent || div.innerText || '';
}

export function formatCrmRichText(value: string | null | undefined): string {
	const decoded = decodeHtmlEntities(value).replace(/\r\n?/g, '\n').trim();
	if (!decoded) return '';

	return decoded
		.replace(/<\s*br\s*\/?\s*>/gi, '\n')
		.replace(/<\s*li\b[^>]*>/gi, '\n- ')
		.replace(/<\s*\/\s*(p|div|section|article|ul|ol|table|tr|h[1-6])\s*>/gi, '\n\n')
		.replace(/<\s*\/\s*li\s*>/gi, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
