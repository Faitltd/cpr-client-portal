export function decodeHtmlEntities(value: string | null | undefined): string {
	if (!value) return '';
	if (typeof window === 'undefined') {
		return value
			.replace(/&quot;/g, '"')
			.replace(/&#39;|&apos;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
	}

	const div = document.createElement('div');
	div.innerHTML = value;
	return div.textContent || div.innerText || '';
}
