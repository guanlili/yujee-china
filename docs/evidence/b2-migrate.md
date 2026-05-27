# B2 verification log

Run: 2026-05-27T15:05:04Z
Driver: drizzle-orm/postgres-js + postgres 3.4.9
Target: Postgres 15 local. Same SQL applies to Neon dev — bring `DATABASE_URL` and re-run.

## pnpm --filter web db:migrate (clean DB)
```

> @yujee/web@0.0.1 db:migrate /Users/smalldog/Desktop/6.1 必上线/yujee-worktrees/b2/apps/web
> drizzle-kit migrate

No config path provided, using default 'drizzle.config.ts'
Reading config file '/Users/smalldog/Desktop/6.1 必上线/yujee-worktrees/b2/apps/web/drizzle.config.ts'
Using 'postgres' driver for database querying
[⣷] applying migrations...[2K[1G[✓] migrations applied successfully!```

## \dt — 11 tables created
```
                   关联列表
 架构模式 |      名称      |  类型  |  拥有者  
----------+----------------+--------+----------
 public   | accounts       | 数据表 | smalldog
 public   | agent_jobs     | 数据表 | smalldog
 public   | album_messages | 数据表 | smalldog
 public   | album_pages    | 数据表 | smalldog
 public   | albums         | 数据表 | smalldog
 public   | credit_holds   | 数据表 | smalldog
 public   | credit_ledger  | 数据表 | smalldog
 public   | customers      | 数据表 | smalldog
 public   | sessions       | 数据表 | smalldog
 public   | users          | 数据表 | smalldog
 public   | verifications  | 数据表 | smalldog
(11 行记录)

```

## \di — indexes (incl. partial)
```
                                    关联列表
 架构模式 |               名称               | 类型 |  拥有者  |     数据表     
----------+----------------------------------+------+----------+----------------
 public   | accounts_pkey                    | 索引 | smalldog | accounts
 public   | agent_jobs_pkey                  | 索引 | smalldog | agent_jobs
 public   | agent_jobs_request_id_unique     | 索引 | smalldog | agent_jobs
 public   | album_messages_pkey              | 索引 | smalldog | album_messages
 public   | album_pages_pkey                 | 索引 | smalldog | album_pages
 public   | albums_pkey                      | 索引 | smalldog | albums
 public   | credit_holds_pkey                | 索引 | smalldog | credit_holds
 public   | credit_ledger_pkey               | 索引 | smalldog | credit_ledger
 public   | customers_pkey                   | 索引 | smalldog | customers
 public   | idx_accounts_user                | 索引 | smalldog | accounts
 public   | idx_agent_jobs_running_started   | 索引 | smalldog | agent_jobs
 public   | idx_agent_jobs_user_created      | 索引 | smalldog | agent_jobs
 public   | idx_album_messages_album_created | 索引 | smalldog | album_messages
 public   | idx_album_messages_user_created  | 索引 | smalldog | album_messages
 public   | idx_album_pages_album            | 索引 | smalldog | album_pages
 public   | idx_albums_active                | 索引 | smalldog | albums
 public   | idx_albums_user_created          | 索引 | smalldog | albums
 public   | idx_credit_holds_holding         | 索引 | smalldog | credit_holds
 public   | idx_credit_holds_user_created    | 索引 | smalldog | credit_holds
 public   | idx_credit_ledger_user_created   | 索引 | smalldog | credit_ledger
 public   | idx_customers_user               | 索引 | smalldog | customers
 public   | idx_sessions_user                | 索引 | smalldog | sessions
 public   | sessions_pkey                    | 索引 | smalldog | sessions
 public   | sessions_token_unique            | 索引 | smalldog | sessions
 public   | uq_accounts_provider_account     | 索引 | smalldog | accounts
 public   | uq_album_pages_album_index       | 索引 | smalldog | album_pages
 public   | uq_customers_provider_external   | 索引 | smalldog | customers
 public   | uq_customers_user_provider       | 索引 | smalldog | customers
 public   | users_email_unique               | 索引 | smalldog | users
 public   | users_pkey                       | 索引 | smalldog | users
 public   | verifications_pkey               | 索引 | smalldog | verifications
(31 行记录)

```

## Foreign keys (14)
```
     table      |                     conname                      
----------------+--------------------------------------------------
 accounts       | accounts_user_id_users_id_fk
 agent_jobs     | agent_jobs_album_id_albums_id_fk
 agent_jobs     | agent_jobs_user_id_users_id_fk
 album_messages | album_messages_album_id_albums_id_fk
 album_messages | album_messages_user_id_users_id_fk
 album_pages    | album_pages_album_id_albums_id_fk
 albums         | albums_user_id_users_id_fk
 credit_holds   | credit_holds_album_id_albums_id_fk
 credit_holds   | credit_holds_user_id_users_id_fk
 credit_ledger  | credit_ledger_related_album_id_albums_id_fk
 credit_ledger  | credit_ledger_related_hold_id_credit_holds_id_fk
 credit_ledger  | credit_ledger_user_id_users_id_fk
 customers      | customers_user_id_users_id_fk
 sessions       | sessions_user_id_users_id_fk
(14 行记录)

```

## pnpm --filter web test:repos (9/9 pass — includes zombie-sweeper tx regression)
```
> tsx --test src/db/repos/*.test.ts src/services/job/zombie-sweeper.test.ts

✔ agentJobRepo: create + findByRequestId + findStaleRunning + update (102.740083ms)
✔ albumMessageRepo: create + findByAlbum + findRecentByAlbum (97.318125ms)
✔ albumPageRepo: bulkInsert + findByAlbum + updateOne (151.74275ms)
✔ albumRepo: create + findById + findByUser + update (229.492583ms)
✔ creditHoldRepo: create + findById + update (81.882ms)
✔ creditLedgerRepo: create + findByUser + sumByUser (104.686708ms)
✔ customerRepo: create + findByUserAndProvider + findByProviderExternalId (102.639292ms)
✔ userRepo: upsert + findById + updateCredit (47.552708ms)
{"level":"info","time":"2026-05-27T15:05:26.117Z","msg":"zombie sweeper run","scanned":1,"failed":1,"releasedHolds":1,"cutoff":"2026-05-27T14:35:26.106Z"}
✔ zombieSweeper: stale RUNNING job → job/album FAILED + hold RELEASED in one tx (56.616916ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 41085.120084
```
