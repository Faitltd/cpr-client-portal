import { json } from '@sveltejs/kit';
import { requireStaffApi } from '$lib/server/designer';
import { getServiceSupabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

const VALID = new Set(['wood', 'dark', 'light']);

// Staff-only: set (or clear) a board's countertop category.
export const POST: RequestHandler = async ({ cookies, request }) => {
	const auth = await requireStaffApi(cookies, ['designer', 'ops']);
	if (!auth.ok) return auth.response;

	const body = await request.json().catch(() => null);
	const board_id = String(body?.board_id ?? '').trim();
	const counter = String(body?.counter ?? '').trim();
	if (!board_id) return json({ message: 'board_id required' }, { status: 400 });

	const supa = getServiceSupabase();

	if (counter === '') {
		const { error } = await supa.from('moodboard_board_tags').delete().eq('board_id', board_id);
		if (error) return json({ message: error.message }, { status: 500 });
		return json({ ok: true, board_id, counter: null });
	}

	if (!VALID.has(counter)) return json({ message: 'invalid counter' }, { status: 400 });

	const { error } = await supa
		.from('moodboard_board_tags')
		.upsert({ board_id, counter, updated_at: new Date().toISOString() }, { onConflict: 'board_id' });
	if (error) return json({ message: error.message }, { status: 500 });
	return json({ ok: true, board_id, counter });
};
