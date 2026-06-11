import { json } from '@sveltejs/kit';
import {
	isNoAdminTokensError,
	listBooksInvoicesForEmail,
	requireDesigner
} from '$lib/server/designer';
import { createLogger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.financials.invoices');

export const GET: RequestHandler = async ({ cookies, url }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const email = String(url.searchParams.get('email') || '')
		.trim()
		.toLowerCase();
	if (!email) {
		return json({ message: 'email is required' }, { status: 400 });
	}

	try {
		const invoices = await listBooksInvoicesForEmail(email);
		return json({ invoices });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unable to load invoices';
		log.error('invoice list failed', { error: message });
		if (isNoAdminTokensError(err)) {
			return json(
				{ message: 'Zoho is not connected. An admin must complete OAuth first.' },
				{ status: 503 }
			);
		}
		return json({ message }, { status: 502 });
	}
};
