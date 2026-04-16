/**
 * Seed script — first designer account
 * Usage: npx tsx scripts/seed-designer.ts
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (never commit those).
 * The raw password is read from the DESIGNER_PASSWORD env var — do NOT hard-code it here.
 *
 * Run once after applying migration 20260416151800_designer_portal.sql
 *
 * Rollback:
 *   DELETE FROM designers WHERE email = 'marysue@homecpr.pro';
 */

import 'dotenv/config';
import { hashPassword } from '../src/lib/server/password.js';
import { upsertDesigner, setDesignerPassword } from '../src/lib/server/db.js';

const EMAIL = 'marysue@homecpr.pro';
const RAW_PW = process.env.DESIGNER_PASSWORD;

if (!RAW_PW) {
  console.error('ERROR: Set DESIGNER_PASSWORD env var before running this script.');
  process.exit(1);
}

async function main() {
  console.log(`Upserting designer: ${EMAIL}`);
  const designer = await upsertDesigner({ email: EMAIL, name: 'Mary Sue', active: true });
  console.log(`  → designer.id: ${designer.id}`);

  const hash = await hashPassword(RAW_PW);
  console.log(`  → password_hash: ${hash}`);
  // Raw password is NOT logged or stored

  await setDesignerPassword(designer.id, hash);
  console.log(`  → password_hash written to designers row`);
  console.log('Done. Verify with:');
  console.log(`  SELECT id, email, active, left(password_hash,20)||'...' AS hash_prefix FROM designers WHERE email = '${EMAIL}';`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
