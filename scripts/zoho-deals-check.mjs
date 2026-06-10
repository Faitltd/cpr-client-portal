import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const raw = fs.readFileSync('.env', 'utf8');
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const idx = line.indexOf('=');
  if (idx === -1) continue;
  process.env[line.slice(0, idx)] = line.slice(idx + 1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const { data: clientRow } = await supabase
  .from('clients')
  .select('*')
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();

const { data: tokenRow } = await supabase
  .from('zoho_tokens')
  .select('*')
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (!clientRow || !tokenRow) {
  console.log('Missing client or token row');
  process.exit(0);
}

console.log('Client:', {
  id: clientRow.id,
  zoho_contact_id: clientRow.zoho_contact_id,
  email: clientRow.email,
  first_name: clientRow.first_name,
  last_name: clientRow.last_name,
  full_name: clientRow.full_name
});

const token = tokenRow.access_token;
const base = 'https://www.zohoapis.com/crm/v8';
const fields = 'Deal_Name,Stage,Amount,Closing_Date,Created_Time,Modified_Time,Owner,Contact_Name,Account_Name';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  const text = await res.text();
  return { status: res.status, text };
}

const relatedUrl = `${base}/Contacts/${clientRow.zoho_contact_id}/Deals?fields=${encodeURIComponent(fields)}&per_page=200`;
const related = await fetchJson(relatedUrl);
console.log('Contacts related status', related.status, 'body', related.text.slice(0, 300));

const searchCriteria = `(Contact_Name:equals:${clientRow.zoho_contact_id})`;
const searchUrl = `${base}/Deals/search?criteria=${encodeURIComponent(searchCriteria)}&fields=${encodeURIComponent(fields)}`;
const search = await fetchJson(searchUrl);
console.log('Deals search status', search.status, 'body', search.text.slice(0, 300));

const listUrl = `${base}/Deals?fields=${encodeURIComponent(fields)}&per_page=200`;
const list = await fetchJson(listUrl);
console.log('Deals list status', list.status, 'body', list.text.slice(0, 300));
