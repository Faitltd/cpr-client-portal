import { getSession, type ClientSession } from './db';
import { getDealsForClient } from './projects';

type ClientDashboardDeal = {
	id?: string;
	Deal_Name?: string | null;
};

export type ClientDashboardContext = {
	session: ClientSession;
	deals: ClientDashboardDeal[];
};

export async function getClientDashboardContext(
	sessionToken: string | null | undefined
): Promise<ClientDashboardContext | null> {
	const normalizedToken = typeof sessionToken === 'string' ? sessionToken.trim() : '';
	if (!normalizedToken) return null;

	const session = await getSession(normalizedToken);
	if (!session || new Date(session.expires_at) < new Date()) {
		return null;
	}

	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	return {
		session,
		deals
	};
}
