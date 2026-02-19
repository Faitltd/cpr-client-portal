import { execSync } from 'node:child_process';

const raw = execSync('supabase status --output json', { encoding: 'utf8' });
const data = JSON.parse(raw);
const entries = Object.entries(data);
const norm = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const pick = (names) => {
  for (const [key, value] of entries) {
    if (names.includes(norm(key))) return value;
  }
  return '';
};

const apiUrl = pick(['apiurl', 'supabaseurl']) || 'http://127.0.0.1:54321';
const anonKey = pick(['anonkey', 'anonapikey', 'anon']);
const serviceKey = pick(['servicerolekey', 'serviceroleapikey', 'servicekey']);

const lines = [
  `VITE_SUPABASE_URL=${apiUrl}`,
  `SUPABASE_URL=${apiUrl}`,
  `VITE_SUPABASE_ANON_KEY=${anonKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`
];

process.stdout.write(lines.join('\n') + '\n');
