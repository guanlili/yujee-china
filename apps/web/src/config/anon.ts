// 游客(匿名)模式的产品硬上限。设计:docs/superpowers/specs/2026-08-04-anon-guest-flow-design.md
//
// 匿名照片上限刻意等于 FREE_PLAN_CREDITS(20):登录转正后自动补跑真 compose 时,
// 新账号的注册赠送积分恰好覆盖首本书,不会刚登录就撞 402 付费墙。
// 改这里要同时过一遍 config/pricing.ts 的 FREE_PLAN_CREDITS。

/** 匿名单次生成(建相册/加照片累计)照片上限;登录用户走 MAX_PHOTOS_PER_GENERATION(100)。 */
export const ANON_MAX_PHOTOS_PER_GENERATION = 20;

/** 每个匿名账号最多几本相册;超出让前端弹登录。 */
export const ANON_MAX_ALBUMS = 1;

/** 匿名注册(/sign-in/anonymous)每 IP 每小时上限,挡脚本刷账号行。 */
export const ANON_SIGNUP_PER_IP_PER_HOUR = 5;

/** 创建超过这么多天、仍未转正、**且一本书都没做**的匿名账号被 cron 清理。
 *  做过书的游客不受此限,永久保留(他们是转化漏斗上唯一的样本)。 */
export const ANON_CLEANUP_DAYS = 7;
