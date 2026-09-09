import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getServiceSupabase } from '$lib/server/db';
import type { PageServerLoad } from './$types';

type Row = {
	client_key: string;
	board_id: string;
	favorite: boolean;
	note: string | null;
	updated_at: string;
};

type Item = Row & {
	colorId: string;
	colorName: string;
	styleName: string;
	src: number;
	tag: string;
	img: string;
	label: string;
};

type ClientGroup = {
	key: string;
	count: number;
	notes: number;
	lastUpdated: string | null;
	items: Item[];
};

export const load: PageServerLoad = async ({ cookies, fetch }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw redirect(302, '/admin/login');
	}

	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from('moodboard_selections')
		.select('client_key,board_id,favorite,note,updated_at')
		.order('client_key', { ascending: true })
		.order('updated_at', { ascending: false });

	if (error) {
		return { clients: [] as ClientGroup[], loadError: error.message };
	}

	// Build a board_id -> board metadata index from the published catalog.
	const index: Record<string, Omit<Item, keyof Row>> = {};
	try {
		const res = await fetch('/moodboard/data.json');
		if (res.ok) {
			const cat = await res.json();
			for (const c of cat.colors ?? []) {
				for (const st of c.styles ?? []) {
					for (const b of st.boards ?? []) {
						index[b.id] = {
							colorId: c.id,
							colorName: c.name,
							styleName: st.name,
							src: b.src,
							tag: b.tag,
							img: b.img,
							label: `${b.src}${b.tag}`
						};
					}
				}
			}
		}
	} catch (e) {
		// If the catalog can't be read, we still return raw rows below.
	}

	const groups = new Map<string, ClientGroup>();
	for (const row of (data as Row[]) ?? []) {
		if (!row.favorite && !(row.note && row.note.trim())) continue;
		const meta = index[row.board_id];
		const item: Item = {
			...row,
			colorId: meta?.colorId ?? '',
			colorName: meta?.colorName ?? 'Unknown',
			styleName: meta?.styleName ?? row.board_id,
			src: meta?.src ?? 0,
			tag: meta?.tag ?? '',
			img: meta?.img ?? '',
			label: meta?.label ?? row.board_id
		};
		let g = groups.get(row.client_key);
		if (!g) {
			g = { key: row.client_key, count: 0, notes: 0, lastUpdated: null, items: [] };
			groups.set(row.client_key, g);
		}
		g.items.push(item);
		g.count += 1;
		if (item.note && item.note.trim()) g.notes += 1;
		if (!g.lastUpdated || row.updated_at > g.lastUpdated) g.lastUpdated = row.updated_at;
	}

	const clients = [...groups.values()].sort((a, b) =>
		(b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? '')
	);

	return { clients };
};
