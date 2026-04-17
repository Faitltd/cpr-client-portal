import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities, formatCrmRichText } from './html';

describe('decodeHtmlEntities', () => {
	it('decodes common named and numeric entities during SSR', () => {
		expect(decodeHtmlEntities('Tom &amp; Jerry&nbsp;&#39;s &#x41;')).toBe("Tom & Jerry 's A");
	});
});

describe('formatCrmRichText', () => {
	it('preserves line breaks and list items from CRM html', () => {
		const input =
			'Overview&lt;br&gt;Demo scope&lt;/br&gt;&lt;ul&gt;&lt;li&gt;Protect floors&lt;/li&gt;&lt;li&gt;Install tile&lt;/li&gt;&lt;/ul&gt;';

		expect(formatCrmRichText(input)).toBe('Overview\nDemo scope\n- Protect floors\n- Install tile');
	});

	it('normalizes paragraphs and strips remaining tags', () => {
		const input = '<p>Phase 1</p><div>Existing vanity removal</div><p><strong>Phase 2</strong></p>';

		expect(formatCrmRichText(input)).toBe('Phase 1\n\nExisting vanity removal\n\nPhase 2');
	});

	it('removes zero-width separators from CRM note content', () => {
		const input =
			'Existing conditions<br>Upstairs hall bath: Oversized tub.<br>​<br><br>Ideas and constraints<br>Plumbing/toilet: Use existing stack.';

		expect(formatCrmRichText(input)).toBe(
			'Existing conditions\nUpstairs hall bath: Oversized tub.\n\nIdeas and constraints\nPlumbing/toilet: Use existing stack.'
		);
	});
});
