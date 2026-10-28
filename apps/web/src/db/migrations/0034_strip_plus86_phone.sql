-- 存量 +86 前缀手机号收敛为大陆 11 位裸号(2026-10-28,手机号归一收紧配套)。
-- 免验证期(2026-10-27~28)注册的「+86138…」混格式行:归一函数此后剥 +86,
-- 不收敛就会出现「注册得了、登录不回」(登录/找回都是精确匹配查询)。
-- 只收敛剥前缀后是合法大陆号的行(~ '^\+861[3-9]\d{9}$');其余 +86 怪格式
-- (老归一放宽期收下的)留着不动 —— 它们在新口径下本就不可达,强改无意义。
-- NOT EXISTS 防撞 users.phone_number 唯一索引:同一号码若曾以两种格式各注册过
-- 一个账号,撞车的 +86 行保留原值(该裸号账号可正常登录,+86 行不再可达,
-- 强改只会让迁移失败)。号量小(免验证期仅一天),撞车概率趋近于零。
UPDATE users
SET phone_number = regexp_replace(phone_number, '^\+86', '')
WHERE phone_number ~ '^\+861[3-9]\d{9}$'
  AND NOT EXISTS (
    SELECT 1 FROM users w
    WHERE w.phone_number = regexp_replace(users.phone_number, '^\+86', '')
  );--> statement-breakpoint
-- 占位邮箱({手机号}@phone.yujee.local)由手机号派生,随手机号一起剥前缀,
-- 保持 findUserByEmail 与新生成占位邮箱同口径。同样带唯一索引防撞保护。
UPDATE users
SET email = regexp_replace(email, '^\+86', '')
WHERE email ~ '^\+861[3-9]\d{9}@phone\.yujee\.local$'
  AND NOT EXISTS (
    SELECT 1 FROM users w
    WHERE w.email = regexp_replace(users.email, '^\+86', '')
  );
