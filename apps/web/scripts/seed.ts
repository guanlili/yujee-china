import { db } from '../src/db/client';
import { userRepo } from '../src/db/repos/user-repo';
import { env } from '../src/lib/env';

async function main() {
  await userRepo.upsertById(db, {
    id: env.DEMO_USER_ID,
    email: env.DEMO_USER_EMAIL,
    name: 'Demo User',
    creditBalance: 1000,
  });
  console.log(`✓ seeded demo user ${env.DEMO_USER_ID}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
