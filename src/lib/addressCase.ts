// Normalize an all-caps assessor address to readable title case.
// Keeps directionals (S, NE, …) uppercase and the state code (the 2-letter token
// right before the ZIP) uppercase, and leaves numeric tokens (house number, ZIP)
// untouched. State detection is positional so a street suffix like "CT" (Court)
// becomes "Ct" instead of being mistaken for Connecticut.

const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

const STATES = new Set([
	'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
	'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
	'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
	'WI', 'WY', 'DC'
]);

const core = (tok: string) => tok.replace(/[^A-Za-z0-9]/g, '');

function caseToken(tok: string, forceUpper: boolean): string {
	const m = tok.match(/^([^A-Za-z0-9]*)([A-Za-z0-9'.\-/]*)([^A-Za-z0-9]*)$/);
	if (!m) return tok;
	const [, pre, body, post] = m;
	if (!body) return tok;
	if (/\d/.test(body)) return pre + body + post; // house number, ZIP, ranges — leave as-is
	const upper = body.toUpperCase();
	if (forceUpper || DIRECTIONALS.has(upper)) return pre + upper + post;
	return pre + upper.charAt(0) + body.slice(1).toLowerCase() + post;
}

export function titleCaseAddress(input: string | null | undefined): string {
	if (!input) return '';
	const tokens = input.trim().split(/\s+/);

	// The state is the 2-letter token immediately before the ZIP.
	let stateIdx = -1;
	const zipIdx = tokens.findIndex((t) => /^\D*\d{5}(-\d{4})?\D*$/.test(t));
	if (zipIdx > 0) {
		for (let i = zipIdx - 1; i >= 0; i--) {
			const c = core(tokens[i]);
			if (!c) continue;
			if (c.length === 2 && STATES.has(c.toUpperCase())) stateIdx = i;
			break;
		}
	}

	return tokens.map((tok, i) => caseToken(tok, i === stateIdx)).join(' ');
}
