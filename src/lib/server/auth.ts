import { zohoApiCall } from './zoho';
import type { PortalUser } from './db';

/**
 * Get Zoho Contact ID from access token
 * Uses the /users?type=CurrentUser endpoint to identify the authenticated user
 */
export async function getAuthenticatedContact(accessToken: string): Promise<PortalUser> {
	try {
		// Get current user from Zoho CRM
		const response = await zohoApiCall(accessToken, '/users?type=CurrentUser');
		const user = response.users?.[0];

		if (!user) {
			throw new Error('No user found in Zoho response');
		}

		// For portal users, we need to find their Contact record
		// Search by email to get the Contact ID
		const contactSearch = await zohoApiCall(
			accessToken,
			`/Contacts/search?email=${encodeURIComponent(user.email)}`
		);

		const contact = contactSearch.data?.[0];
		if (!contact) {
			throw new Error('Contact record not found for user');
		}

		return {
			id: contact.id,
			zoho_contact_id: contact.id,
			email: contact.Email || user.email,
			name: contact.Full_Name || `${contact.First_Name} ${contact.Last_Name}`,
			company: contact.Account_Name?.name,
			phone: contact.Phone,
			is_active: true,
			last_login: new Date().toISOString()
		};
	} catch (error) {
		console.error('Failed to get authenticated contact:', error);
		throw error;
	}
}

/**
 * Filter deals to only show those related to the authenticated contact
 * Uses COQL (Zoho's query language) for precise filtering
 */
export async function getContactDeals(accessToken: string, contactId: string) {
	try {
		// Query deals where Contact_Name equals the authenticated contact
		const query = {
			select_query: `SELECT Deal_Name, Stage, Amount, Closing_Date, Created_Time, Modified_Time, Owner FROM Deals WHERE Contact_Name = '${contactId}' ORDER BY Created_Time DESC`
		};

		const response = await zohoApiCall(accessToken, '/coql', {
			method: 'POST',
			body: JSON.stringify(query)
		});

		return response.data || [];
	} catch (error) {
		// Fallback to standard API with filtering
		console.warn('COQL query failed, falling back to standard API');
		const deals = await zohoApiCall(accessToken, '/Deals');
		
		// Client-side filtering if COQL not available
		return (deals.data || []).filter((deal: any) => 
			deal.Contact_Name?.id === contactId
		);
	}
}

/**
 * Get documents/attachments for deals visible to contact
 */
export async function getContactDocuments(accessToken: string, dealId: string) {
	return zohoApiCall(accessToken, `/Deals/${dealId}/Attachments`);
}

/**
 * Get notes for a specific deal
 */
export async function getDealNotes(accessToken: string, dealId: string) {
	return zohoApiCall(accessToken, `/Deals/${dealId}/Notes`);
}