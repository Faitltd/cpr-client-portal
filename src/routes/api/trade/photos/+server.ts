import { json } from '@sveltejs/kit';
import { getTradeSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

type TradePhoto = {
	id: string;
	projectName: string;
	workType: string;
	submittedAt: string;
	url: string;
	caption?: string;
};

const buildMockPhotos = (): TradePhoto[] => {
	const now = Date.now();
	const toIso = (offsetDays: number) => new Date(now - offsetDays * 24 * 60 * 60 * 1000).toISOString();

	// TODO: Replace mocked photos with storage from Zoho WorkDrive / CRM / Supabase.
	return [
		{
			id: 'photo-axv-1001',
			projectName: 'Maple Ridge - Lot 14',
			workType: 'Framing',
			submittedAt: toIso(2),
			url: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=80',
			caption: 'South wall framing complete.'
		},
		{
			id: 'photo-axv-1002',
			projectName: 'Maple Ridge - Lot 14',
			workType: 'Electrical',
			submittedAt: toIso(1),
			url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
			caption: 'Panel rough-in before inspection.'
		},
		{
			id: 'photo-brk-2031',
			projectName: 'Canyon View Remodel',
			workType: 'Drywall',
			submittedAt: toIso(5),
			url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=80',
			caption: 'Living room board hung and taped.'
		},
		{
			id: 'photo-brk-2032',
			projectName: 'Canyon View Remodel',
			workType: 'Plumbing',
			submittedAt: toIso(8),
			url: 'https://images.unsplash.com/photo-1581092335397-9583eb92d232?auto=format&fit=crop&w=1200&q=80',
			caption: 'Kitchen sink supply lines installed.'
		},
		{
			id: 'photo-cst-3110',
			projectName: 'Seaside Townhomes - Unit 3A',
			workType: 'Finish Carpentry',
			submittedAt: toIso(12),
			url: 'https://images.unsplash.com/photo-1501183638710-841dd1904471?auto=format&fit=crop&w=1200&q=80',
			caption: 'Baseboards and trim installed.'
		}
	];
};

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	return json({ photos: buildMockPhotos() });
};
