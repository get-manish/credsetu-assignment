import { pool } from '../src/db';

// Demo data for screen recordings. Log in with this phone, then read the OTP from the server console.
const DEMO_PHONE = '+919999999999';

// day_offset is relative to today: negative = already past due.
const SAMPLE_LOANS = [
  { friend: 'Rahul Sharma', amount: 2500, dayOffset: -12, repaid: false }, // overdue
  { friend: 'Priya Nair', amount: 800.5, dayOffset: -3, repaid: false }, // overdue
  { friend: 'Amit Verma', amount: 5000, dayOffset: 10, repaid: false }, // pending
  { friend: 'Sneha Iyer', amount: 1200, dayOffset: 25, repaid: false }, // pending
  { friend: 'Karan Mehta', amount: 3000, dayOffset: -20, repaid: true }, // repaid
];

async function seed(): Promise<void> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (phone) VALUES ($1)
     ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING id`,
    [DEMO_PHONE],
  );
  const userId = user.rows[0].id;

  // Start clean so running the seed twice doesn't duplicate loans.
  await pool.query('DELETE FROM loans WHERE user_id = $1', [userId]);

  for (const loan of SAMPLE_LOANS) {
    await pool.query(
      `INSERT INTO loans (user_id, friend_name, amount, due_date, is_repaid, repaid_at)
       VALUES ($1, $2, $3, CURRENT_DATE + $4::int, $5, CASE WHEN $5::boolean THEN now() ELSE NULL END)`,
      [userId, loan.friend, loan.amount, loan.dayOffset, loan.repaid],
    );
  }

  console.log(`Seeded demo user ${DEMO_PHONE} with ${SAMPLE_LOANS.length} loans (2 overdue).`);
  console.log('Log in with that phone number and read the OTP from the server console.');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
