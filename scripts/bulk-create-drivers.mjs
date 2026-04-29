import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8')
  .split('\n')
  .filter(l => l.includes('='))
  .reduce((acc, l) => {
    const [k, ...v] = l.split('=');
    acc[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    return acc;
  }, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const drivers = [
  { email: 'sarah@test',  name: 'Sarah Kim',       phone: '+1-555-0102', vehicle: 'Honda Civic #2' },
  { email: 'alex@test',   name: 'Alex Thompson',   phone: '+1-555-0103', vehicle: 'Toyota Corolla #3' },
  { email: 'jordan@test', name: 'Jordan Chen',     phone: '+1-555-0104', vehicle: 'Subaru Outback #4' },
];

for (const d of drivers) {
  console.log(`Creating ${d.email}...`);

  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email: d.email,
    password: 'test1234',
    email_confirm: true,
  });

  if (userError) {
    console.error(`  Failed to create auth user: ${userError.message}`);
    continue;
  }

  const userId = userData.user.id;

  const { error: profileError } = await supabase
    .from('profiles')
    .insert({ id: userId, role: 'driver', full_name: d.name, phone: d.phone });

  if (profileError) {
    console.error(`  Profile insert failed: ${profileError.message}`);
    continue;
  }

  const { error: driverError } = await supabase
    .from('drivers')
    .insert({ profile_id: userId, vehicle_label: d.vehicle, active: true });

  if (driverError) {
    console.error(`  Driver insert failed: ${driverError.message}`);
    continue;
  }

  console.log(`  ✅ Created ${d.name} (${d.email})`);
}

console.log('\nDone!');
