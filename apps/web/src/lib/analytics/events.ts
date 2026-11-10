// 埋点的事件契约(前后端共用)。
//
// 为什么要有白名单而不是随便 track 任意名字:一是防止临时调试字符串污染数据、
// 让「成功率的分子分母」不可信;二是隐私 —— 任意字符串迟早会被塞进正文、手机号、
// 照片 URL。写死的事件名 + 写死的 meta key,才能在写入侧做真正的字段级拦截。
//
// 新增事件时在这里加一行,并在写入侧确认它不带任何个人信息。

export const ANALYTICS_EVENT_NAMES = [
  // 漏斗
  'landing_view', // 首页打开
  'book_start', // 点「开始做一本书」/进入编辑器
  'checkout_click', // 点购买/兑换入口
  // 导出(最能反映「卡不卡」的地方)
  'export_start',
  'export_ok', // value = 耗时 ms
  'export_fail', // value = 耗时 ms,result = fail/timeout
  // 云端备份上传(此前「偶发挂住」的现场)
  'upload_ok', // value = 成功张数
  'upload_fail', // value = 失败张数
  // 前端错误(替代第三方错误监控;只记消息与来源,不记页面正文)
  'client_error',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

// meta 允许的 key。不在表里的键在写入侧直接丢弃,不报错。
// 只允许「短、无内容、可枚举」的信息:数量、步数、状态码、脱敏后的错误消息。
export const ANALYTICS_META_KEYS = [
  'pages', // 页数
  'photos', // 照片数
  'attempt', // 第几次重试
  'step', // 失败发生在哪一步(sign/put/confirm/render/upload)
  'status', // HTTP 状态码
  'code', // 错误码
  'kind', // 错误类型
  'source', // 脚本/文件来源
  'message', // 脱敏后的错误消息(截断)
  'locale', // 语言
  'bleed', // 出血版(0/3)
  'mode', // 触发场景(desktop/mobile)
] as const;

export type AnalyticsMetaKey = (typeof ANALYTICS_META_KEYS)[number];

export type AnalyticsMeta = Partial<Record<AnalyticsMetaKey, string | number | boolean>>;

export type AnalyticsEventPayload = {
  name: AnalyticsEventName;
  albumId?: string;
  value?: number;
  result?: 'ok' | 'fail' | 'timeout' | 'skipped';
  meta?: AnalyticsMeta;
};

export const ANALYTICS_RESULTS = ['ok', 'fail', 'timeout', 'skipped'] as const;

// 单次请求最多携带的事件数。前端批量冲,后端硬上限 —— 不限的话一个脚本就能把表塞满。
export const ANALYTICS_MAX_BATCH = 20;
// meta 值长度上限(字符)。错误消息往往很长且可能夹带 URL/邮箱,截断后再落库。
export const ANALYTICS_META_VALUE_MAX = 120;

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export function isAnalyticsMetaKey(value: string): value is AnalyticsMetaKey {
  return (ANALYTICS_META_KEYS as readonly string[]).includes(value);
}

// 错误消息脱敏:去掉 query string(里面可能有 token/邮箱)、压掉空白、截断。
export function sanitizeAnalyticsMessage(raw: string): string {
  return raw
    .replace(/\?[^\s]*/g, '') // 去掉 ?a=b&c=d 这类
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>') // 邮箱
    .replace(/\+?\d[\d\s-]{7,}\d/g, '<number>') // 手机号/长数字
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ANALYTICS_META_VALUE_MAX);
}
