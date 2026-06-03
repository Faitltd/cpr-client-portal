/**
 * Minimal Markdown → HTML for bot replies. Handles what the bot actually
 * produces (links, bold, italic, inline code, headings, tables, lists,
 * paragraphs). Escapes HTML first so user-uploaded data can't inject script.
 *
 * Not a general-purpose Markdown engine — only the constructs we ship.
 */

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderInline(s: string): string {
	let out = escapeHtml(s);
	// Inline code: `code`
	out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
	// Bold: **text**
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	// Italic: *text* (avoid matching inside ** by requiring non-* on each side)
	out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
	// Links: [text](url) — only http(s) urls are linked
	out = out.replace(
		/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
	);
	// Bare http(s) URLs (only if not already inside an <a>).
	out = out.replace(
		/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g,
		'$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
	);
	return out;
}

function renderTable(rows: string[]): string {
	// rows[0] = header, rows[1] = separator, rest = body
	if (rows.length < 2) return rows.map(renderInline).join('<br>');
	const splitRow = (line: string) =>
		line
			.replace(/^\s*\|/, '')
			.replace(/\|\s*$/, '')
			.split('|')
			.map((c) => c.trim());
	const header = splitRow(rows[0]);
	const body = rows.slice(2).map(splitRow);
	const headHtml = `<thead><tr>${header.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`;
	const bodyHtml = body
		.map((cells) => `<tr>${cells.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
		.join('');
	return `<table class="md-table">${headHtml}<tbody>${bodyHtml}</tbody></table>`;
}

export function renderMarkdown(input: string): string {
	if (!input) return '';
	const lines = input.split(/\r?\n/);
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		// Skip blank lines (paragraph separators)
		if (!line.trim()) {
			i += 1;
			continue;
		}

		// Headings
		const h = line.match(/^(#{1,6})\s+(.*)$/);
		if (h) {
			const level = h[1].length;
			out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
			i += 1;
			continue;
		}

		// Tables: a header row, then a separator like |---|---|, then body rows
		if (
			line.includes('|') &&
			i + 1 < lines.length &&
			/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])
		) {
			const tableRows: string[] = [];
			while (i < lines.length && lines[i].includes('|')) {
				tableRows.push(lines[i]);
				i += 1;
			}
			out.push(renderTable(tableRows));
			continue;
		}

		// Unordered list block
		if (/^\s*[-*]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
				i += 1;
			}
			out.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
			continue;
		}

		// Ordered list block
		if (/^\s*\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
				i += 1;
			}
			out.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ol>`);
			continue;
		}

		// Paragraph: collect consecutive non-blank lines
		const para: string[] = [line];
		i += 1;
		while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s+|[-*]\s+|\d+\.\s+)/.test(lines[i])) {
			para.push(lines[i]);
			i += 1;
		}
		out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
	}
	return out.join('\n');
}
