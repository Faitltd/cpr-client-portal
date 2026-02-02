import { redirect } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) {
		throw redirect(302, '/auth/client');
	}

	const session = await getSession(sessionToken);
	if (!session) {
		throw redirect(302, '/auth/client');
	}

	return {
		email: session.client.email
	};
};
