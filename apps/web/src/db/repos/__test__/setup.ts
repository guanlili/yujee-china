import { sql } from 'drizzle-orm';
import { db } from '../../client';
import { userRepo } from '../user-repo';
import { albumRepo } from '../album-repo';
import {
  agentJobs,
  albumMessages,
  albumPages,
  albums,
  creditHolds,
  creditLedger,
  customers,
  users,
} from '../../schema';

let probed = false;
let online = false;

export async function isDbReachable(): Promise<boolean> {
  if (probed) return online;
  probed = true;
  try {
    await db.execute(sql`select 1`);
    online = true;
  } catch {
    online = false;
  }
  return online;
}

export async function makeUser(suffix: string) {
  return userRepo.upsertById(db, {
    email: `repo-test-${suffix}-${Date.now()}@yujee.test`,
    name: `Repo Test ${suffix}`,
    creditBalance: 100,
  });
}

export async function makeAlbum(userId: string, overrides: Partial<{ title: string; prompt: string; photoCount: number }> = {}) {
  return albumRepo.create(db, {
    userId,
    title: overrides.title ?? 'Test Album',
    prompt: overrides.prompt ?? 'a memoir prompt',
    photoCount: overrides.photoCount ?? 5,
    status: 'AGENT_RUNNING',
    pageCount: 0,
  });
}

export async function cleanupUser(userId: string) {
  await db.delete(creditLedger).where(sql`${creditLedger.userId} = ${userId}`);
  await db.delete(albumMessages).where(sql`${albumMessages.userId} = ${userId}`);
  await db.delete(agentJobs).where(sql`${agentJobs.userId} = ${userId}`);
  await db.delete(albumPages).where(
    sql`${albumPages.albumId} in (select id from ${albums} where user_id = ${userId})`,
  );
  await db.delete(creditHolds).where(sql`${creditHolds.userId} = ${userId}`);
  await db.delete(albums).where(sql`${albums.userId} = ${userId}`);
  await db.delete(customers).where(sql`${customers.userId} = ${userId}`);
  await db.delete(users).where(sql`${users.id} = ${userId}`);
}
