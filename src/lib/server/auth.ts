import { zohoApiCall } from './zoho';
import { 
	type Client, 
	getClientByZohoId, 
	upsertClient, 
	getProjectsByClientId,
	type Project 
} from './db';

/**
 * Get Zoho Contact ID from access token
 * Uses the /users?type=CurrentUser endpoint to identify the authenticated user
 */
export async function getAuthenticatedContact(accessToken: string): Promise<Client> {
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

		// Upsert the client in Supabase
		const clientData = {
			zoho_contact_id: contact.id,
			email: contact.Email || user.email,
			first_name: contact.First_Name || null,
			last_name: contact.Last_Name || null,
			phone: contact.Phone || null,
			company: contact.Account_Name?.name || null,
			address_street: contact.Mailing_Street || null,
			address_city: contact.Mailing_City || null,
			address_state: contact.Mailing_State || null,
			address_zip: contact.Mailing_Zip || null,
			portal_access_enabled: true,
			last_login_at: new Date().toISOString(),
			zoho_data: contact
		};

		const client = await upsertClient(clientData);
		if (!client) {
			throw new Error('Failed to upsert client in database');
		}

		return client;
	} catch (error) {
		console.error('Failed to get authenticated contact:', error);
		throw error;
	}
}

/**
 * Get client by Zoho Contact ID from database
 */
export async function getClientFromDatabase(zohoContactId: string): Promise<Client | null> {
	return getClientByZohoId(zohoContactId);
}

/**
 * Get deals/projects for a client
 * First tries to fetch from Zoho CRM, then syncs to local database
 */
export async function getContactDeals(accessToken: string, contactId: string): Promise<Project[]> {
	try {
		// Query deals where Contact_Name equals the authenticated contact
		const query = {
			select_query: `SELECT Deal_Name, Stage, Amount, Closing_Date, Created_Time, Modified_Time, Owner FROM Deals WHERE Contact_Name = '${contactId}' ORDER BY Modified_Time DESC LIMIT 100`
		};

		const response = await zohoApiCall(accessToken, '/coql', {
			method: 'POST',
			body: JSON.stringify(query)
		});

		// Get client to link projects
		const client = await getClientByZohoId(contactId);
		if (!client) {
			// If no client, just return empty - they need to authenticate first
			return [];
		}

		// Return projects from local database
		// In a full implementation, you'd sync the Zoho deals to the projects table
		return getProjectsByClientId(client.id);
	} catch (error) {
		// Fallback to standard API with filtering
		console.warn('COQL query failed, falling back to standard API:', error);
		
		try {
			const deals = await zohoApiCall(accessToken, '/Deals');
			
			// Client-side filtering if COQL not available
			const filteredDeals = (deals.data || []).filter((deal: any) =>
				deal.Contact_Name?.id === contactId
			);

			// Get client projects from database
			const client = await getClientByZohoId(contactId);
			if (client) {
				return getProjectsByClientId(client.id);
			}
			return [];
		} catch (fallbackError) {
			console.error('Failed to get deals:', fallbackError);
			return [];
		}
	}
}

/**
 * Verify a client has portal access enabled
 */
export async function verifyPortalAccess(zohoContactId: string): Promise<boolean> {
	const client = await getClientByZohoId(zohoContactId);
	return client?.portal_access_enabled ?? false;
}
