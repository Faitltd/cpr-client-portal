import { requireStaffPage } from '$lib/server/designer';
import { getServiceSupabase } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
	await requireStaffPage(cookies, url.pathname, ['designer', 'ops']);

	const res = await fetch('/moodboard/data.json');
	const cat = res.ok ? await res.json() : { colors: [] };

	const supa = getServiceSupabase();
	const { data } = await supa.from('moodboard_board_tags').select('board_id,counter');
	const tags: Record<string, string> = {};
	for (const r of data ?? []) tags[r.board_id] = r.counter as string;

	const order = (b: { src: number; tag: string }) => b.src * 10 + (b.tag === 'A' ? 0 : 1);
	const colors = (cat.colors ?? []).map((c: any) => ({
		id: c.id,
		name: c.name,
		boards: c.styles
			.flatMap((st: any) => st.boards.map((b: any) => ({ id: b.id, src: b.src, tag: b.tag, img: b.img })))
			.sort((a: any, b: any) => order(a) - order(b))
	}));

	return { colors, tags };
};
