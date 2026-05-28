import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase } from '$lib/server/db';
import type { PageServerLoad } from './$types';

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies }) => {
	requireAdmin(cookies.get('admin_session'));

	const { data: runs, error } = await supabase
		.from('bot_sync_runs')
		.select(
			'id, started_at, finished_at, duration_ms, trigger, sources, deal_count, ok_count, error_count, deals'
		)
		.order('started_at', { ascending: false })
		.limit(25);

	return {
		runs: error ? [] : runs ?? [],
		loadError: error ? error.message : null
	};
};
