// 一次性清理(2026-07-12,用户确认):删除全部相册及级联数据,保留用户账号与积分余额。
// 在 Vercel 构建期执行(构建环境持有 DATABASE_URL,凭证不出环境),跑完即随下一次
// 部署从 buildCommand 撤除。幂等:空库上重跑无副作用。
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.log('[wipe-albums-once] no DATABASE_URL, skip'); process.exit(0); }
const sql = postgres(url, { max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : 'require', prepare: false });
try {
  const [before] = await sql`SELECT
    (SELECT count(*)::int FROM albums) AS albums,
    (SELECT count(*)::int FROM album_messages) AS msgs,
    (SELECT count(*)::int FROM users) AS users`;
  console.log('[wipe-albums-once] before:', JSON.stringify(before));
  await sql`TRUNCATE TABLE album_messages, album_pages, agent_jobs, credit_holds, credit_ledger, albums, feedback RESTART IDENTITY CASCADE`;
  const [after] = await sql`SELECT
    (SELECT count(*)::int FROM albums) AS albums,
    (SELECT count(*)::int FROM users) AS users,
    (SELECT coalesce(sum(credit_balance),0)::int FROM users) AS total_credits`;
  console.log('[wipe-albums-once] after:', JSON.stringify(after));
} finally {
  await sql.end();
}
