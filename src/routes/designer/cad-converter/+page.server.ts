import { requireStaffPage } from '$lib/server/designer';
import { maxUploadBytes } from '$lib/server/cad-convert';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	await requireStaffPage(cookies, '/designer/cad-converter', ['designer']);

	return {
		maxUploadMb: Math.round(maxUploadBytes() / (1024 * 1024))
	};
};
