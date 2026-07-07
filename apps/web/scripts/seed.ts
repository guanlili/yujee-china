import { and, eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { db } from '../src/db/client';
import { userRepo } from '../src/db/repos/user-repo';
import { accounts, users } from '../src/db/schema';
import { env } from '../src/lib/env';

async function main() {
  const user = await userRepo.upsertById(db, {
    id: env.DEMO_USER_ID,
    email: env.DEMO_USER_EMAIL,
    name: 'Demo User',
    emailVerified: true,
    creditBalance: 1000,
  });

  await db
    .update(users)
    .set({
      email: env.DEMO_USER_EMAIL,
      name: 'Demo User',
      emailVerified: true,
      creditBalance: 1000,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const passwordHash = await hashPassword(env.DEMO_USER_PASSWORD);
  const existingCredential = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.providerId, 'credential'), eq(accounts.accountId, user.id)))
    .limit(1);

  if (existingCredential[0]) {
    await db
      .update(accounts)
      .set({
        userId: user.id,
        password: passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, existingCredential[0].id));
  } else {
    await db.insert(accounts).values({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: passwordHash,
    });
  }

  console.log(`✓ seeded demo user ${env.DEMO_USER_ID} with credential login`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
