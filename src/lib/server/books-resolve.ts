import { zohoApiCall } from '$lib/server/zoho';
import {
	getBooksCustomerByEmail,
	searchBooksCustomersByName,
	getBooksContactById
} from '$lib/server/books';
import { setClientBooksCustomerId, type Client } from '$lib/server/db';

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const zip5 = (v: unknown): string => digits(v).slice(0, 5);
const extractZip = (addr: unknown): string => {
	const m = String(addr ?? '').match(/\b(\d{5})(?:-\d{4})?\b/);
	return m ? m[1] : '';
};
const nameTokens = (name: string): string[] =>
	name.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, '')).filter((t) => t.length >= 2);

interface ClientIdentity {
	zip: string;
	streetNumber: string;
	phone: string; // last 10 digits
}

async function fetchClientIdentity(
	accessToken: string,
	apiDomain: string | undefined,
	client: Client
): Promise<ClientIdentity> {
	let zip = '';
	let street = '';
	let phone = digits(client.phone).slice(-10);
	if (client.zoho_contact_id) {
		try {
			const res = await zohoApiCall(
				accessToken,
				`/Contacts/${encodeURIComponent(client.zoho_contact_id)}?fields=Mailing_Zip,Mailing_Street,Phone`,
				{},
				apiDomain
			);
			const rec = res?.data?.[0] ?? {};
			zip = zip5(rec.Mailing_Zip);
			street = String(rec.Mailing_Street ?? '');
			if (!phone) phone = digits(rec.Phone).slice(-10);
		} catch {
			/* ignore — verification just gets weaker */
		}
	}
	const streetNumber = (street.match(/\d+/) ?? [''])[0];
	return { zip, streetNumber, phone };
}

/**
 * Safely auto-match a client to a Books customer when the email lookup fails.
 * Requires a NAME match AND a corroborating signal (phone or zip+street), and
 * only accepts a single unambiguous candidate — so it can never attach the
 * wrong homeowner's finances. Returns the contact_id, or null.
 */
async function autoMatchBooksCustomer(
	accessToken: string,
	apiDomain: string | undefined,
	client: Client
): Promise<string | null> {
	const fullName = (client.full_name || `${client.first_name ?? ''} ${client.last_name ?? ''}`).trim();
	const lastName = (client.last_name ?? '').trim();
	const query = lastName || fullName;
	const tokens = nameTokens(fullName || lastName);
	if (!query || tokens.length === 0) return null;

	const identity = await fetchClientIdentity(accessToken, apiDomain, client);
	// Refuse to guess without a verification signal.
	if (!identity.zip && !identity.phone) return null;

	const candidates = await searchBooksCustomersByName(accessToken, query).catch(() => [] as any[]);
	const passing = new Set<string>();

	for (const cand of candidates) {
		const cname = String(cand?.contact_name ?? '').toLowerCase();
		if (!tokens.every((t) => cname.includes(t))) continue;

		let verified = false;
		const candPhone = digits(cand?.phone).slice(-10);
		if (identity.phone && candPhone && candPhone === identity.phone) verified = true;

		if (!verified && identity.zip) {
			const detail = await getBooksContactById(accessToken, String(cand.contact_id)).catch(() => null);
			const billing = detail?.billing_address ?? {};
			const candZip = zip5(billing.zipcode) || extractZip(billing.address);
			const candAddr = String(billing.address ?? '');
			if (candZip && candZip === identity.zip && (!identity.streetNumber || candAddr.includes(identity.streetNumber))) {
				verified = true;
			}
		}
		if (verified && cand?.contact_id) passing.add(String(cand.contact_id));
	}

	return passing.size === 1 ? [...passing][0] : null;
}

/**
 * Resolve a client's Zoho Books customer id:
 *   1. explicit books_customer_id on the client (fast path),
 *   2. email lookup,
 *   3. safe auto-match (name + verified) — persisted so it's a one-time heal.
 * Returns null when no confident match exists.
 */
export async function resolveBooksCustomerId(opts: {
	accessToken: string;
	apiDomain?: string;
	client: Client;
}): Promise<string | null> {
	const { accessToken, apiDomain, client } = opts;

	if (client.books_customer_id) {
		const stored = String(client.books_customer_id).trim();
		if (stored) return stored;
	}

	if (client.email) {
		const c = await getBooksCustomerByEmail(accessToken, client.email).catch(() => null);
		if (c?.contact_id) return String(c.contact_id);
	}

	const matched = await autoMatchBooksCustomer(accessToken, apiDomain, client);
	if (matched) {
		await setClientBooksCustomerId(client.id, matched).catch(() => {});
		return matched;
	}
	return null;
}
