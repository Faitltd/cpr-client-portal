/**
 * Seed portal accounts — Ray (admin), Jeff + MarySue (trade partners).
 *
 * Usage: npx tsx scripts/seed-portal-accounts.ts
 *
 * Requires env vars:
 *   SUPABASE_URL                  — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — service role key (server-only)
 *
 * Notes:
 *   - Admin access on this portal is controlled by the PORTAL_ADMIN_PASSWORD env var
 *     (see src/lib/server/admin.ts). There is no admin *user row*. To set Ray's admin
 *     password, update PORTAL_ADMIN_PASSWORD in the Render dashboard — this script does
 *     NOT touch that. It does however upsert a trade_partners row for Ray@homecpr.pro so
 *     Ray can also log in via the trade partner flow if desired.
 *   - Trade partner passwords are stored as PBKDF2 hashes in trade_partners.password_hash.
 *   - Zoho IDs are filled with stable placeholder strings if the row doesn't yet exist.
 *     The normal Zoho sync will update them on the next run.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../src/lib/server/password.js';
import { normalizeEmailAddress } from '../src/lib/server/auth-normalization.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { persistSession: false }
});

type TradeSeed = {
	email: string;
	password: string;
	name: string;
	phone: string | null;
	zoho_placeholder_id: string;
};

const TRADE_PARTNERS: TradeSeed[] = [
	{
		email: 'Ray@homecpr.pro',
		password: 'Th1515ray!',
		name: 'Ray',
		phone: null,
		zoho_placeholder_id: 'seed-ray-homecpr'
	},
	{
		email: 'Jeff@homecpr.pro',
		password: '7203558810',
		name: 'Jeff',
		phone: '7203558810',
		zoho_placeholder_id: 'seed-jeff-homecpr'
	},
	{
		email: 'MarySue@homecpr.pro',
		password: '3036670864',
		name: 'Mary Sue',
		phone: '3036670864',
		zoho_placeholder_id: 'seed-marysue-homecpr'
	}
];

async function upsertTradePartnerAccount(seed: TradeSeed) {
	const email = normalizeEmailAddress(seed.email);
	if (!email) throw new Error(`Invalid email: ${seed.email}`);

	console.log(`\n→ ${email}`);

	// 1) Find any existing row by email (case-insensitive).
	const { data: existing, error: lookupError } = await supabase
		.from('trade_partners')
		.select('id, zoho_trade_partner_id, email, phone')
		.ilike('email', email)
		.maybeSingle();

	if (lookupError) {
		console.warn(`  lookup warning: ${lookupError.message}`);
	}

	const password_hash = hashPassword(seed.password);
	let rowId: string;

	if (existing?.id) {
		console.log(`  found existing row ${existing.id}`);
		const { error: updateError } = await supabase
			.from('trade_partners')
			.update({
				password_hash,
				name: seed.name,
				phone: seed.phone ?? existing.phone ?? null,
				updated_at: new Date().toISOString()
			})
			.eq('id', existing.id);

		if (updateError) throw new Error(`update failed: ${updateError.message}`);
		rowId = existing.id;
	} else {
		console.log('  inserting new row');
		const { data: inserted, error: insertError } = await supabase
			.from('trade_partners')
			.insert({
				zoho_trade_partner_id: seed.zoho_placeholder_id,
				email,
				name: seed.name,
				phone: seed.phone,
				password_hash
			})
			.select('id')
			.single();

		if (insertError) throw new Error(`insert failed: ${insertError.message}`);
		rowId = inserted.id;
	}

	console.log(`  password_hash written for ${email} (id=${rowId})`);
}

async function main() {
	for (const seed of TRADE_PARTNERS) {
		await upsertTradePartnerAccount(seed);
	}

	console.log('\nDone. Verify with:');
	console.log(
		"  SELECT email, phone, left(password_hash,20)||'...' AS hash_prefix FROM trade_partners WHERE email ILIKE '%@homecpr.pro';"
	);
	console.log(
		'\nReminder: Admin portal password is the PORTAL_ADMIN_PASSWORD env var in Render.'
	);
	console.log('Set it to "Th1515ray!" if Ray should use the /admin/login screen.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
