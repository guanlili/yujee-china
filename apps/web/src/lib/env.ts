import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://yujee:yujee@localhost:5432/yujee_dev'),
  // PG 连接 TLS 覆盖(db/client.ts 的 resolveDatabaseSsl)。未设维持启发式:
  // 本地(localhost/127.0.0.1)免 TLS,其余 require。disable = 整体关 TLS
  //(例如 PG 只在可信内网监听、不想挂证书的单机部署)。
  DATABASE_SSL: z.enum(['disable', 'prefer', 'require', 'verify-full']).optional(),
  AGENT_BASE_URL: z.string().url().default('http://localhost:8001'),
  AGENT_SHARED_SECRET: z.string().min(8).default('dev_secret_replace_me'),
  // 2GB CLIP worker(yujee-agent-clip)。**不是** AGENT_BASE_URL 那台机器:
  // /internal/photo-profile 只在装了 onnxruntime + 分割权重的 worker 上开,普通
  // 1GB Agent 的开关关着 => 404。与 engine 的 grouping_clip_base_url 指同一台。
  // 没配 = 抠图 mask 这条能力不存在,渲染安静退回浏览器端(不报错、不挡流程),
  // 所以它**不进 PRODUCTION_REQUIRED**。
  AGENT_CLIP_BASE_URL: z.string().url().optional(),
  // 没配则回落 AGENT_SHARED_SECRET —— 与 engine 的
  // `grouping_clip_secret or agent_shared_secret` 同一条回落规则。
  AGENT_CLIP_SECRET: z.string().min(8).optional(),
  // 设计 Agent（packages/design-agent album server，对话式改书）。secret 未设 => 不带鉴权头（本地 dev）。
  DESIGN_AGENT_BASE_URL: z.string().url().default('http://localhost:8787'),
  DESIGN_AGENT_SHARED_SECRET: z.string().optional(),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(16).default('dev_better_auth_secret_change_me'),

  // Google OAuth —— 已移除 Google 登录(2026-10-27 起,国内版只有邮箱+手机号)。
  // buildSocialProviders 不再读取这两个字段;schema 保留一迭代仅为兼容存量
  // 环境(生产应清空 GOOGLE_*),之后可连字段一起删。
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Sign in with Apple (better-auth social provider). Apple has no static
  // client secret: it's a short-lived ES256 JWT we sign from the .p8 key on the
  // fly (see lib/auth/apple-client-secret.ts). All four must be set to enable
  // Apple sign-in; any missing => Apple disabled, other logins unaffected.
  //  - APPLE_CLIENT_ID  : the Services ID (e.g. com.yujee.web), NOT the app bundle id
  //  - APPLE_TEAM_ID    : 10-char Apple Developer Team ID
  //  - APPLE_KEY_ID     : 10-char Key ID of the Sign-in-with-Apple key
  //  - APPLE_PRIVATE_KEY: contents of the AuthKey_XXXX.p8 (PEM). Newlines may be
  //    stored as literal "\n" — we normalize them before signing.
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  AUTH_EMAIL_FROM: z.string().min(1).default('Yujee <noreply@yujeeai.com>'),
  // 用户反馈转发收件箱(运营者私人邮箱;发件人复用 AUTH_EMAIL_FROM)。
  FEEDBACK_INBOX: z.string().min(3).default('1658152285@qq.com'),
  EMAIL_DELIVERY: z.enum(['capture', 'console', 'resend']).default('capture'),
  EMAIL_CAPTURE_FILE: z.string().min(1).default('.tmp/email-capture.jsonl'),
  RESEND_API_KEY: z.string().optional(),

  // 短信 OTP(阿里云国内短信),镜像 EMAIL_DELIVERY 的开关模式:
  //   capture = 验证码写 EMAIL_CAPTURE_FILE(kind phone-otp / phone-otp-reset),
  //             本地开发、CI、以及「代码先上线、密钥后配」的灰度窗口用它,现有
  //             测试全部保持绿;
  //   aliyun  = 真实下发(lib/sms/aliyun-sms.ts)。
  // 登录/注册与找回共用一个验证码模板(变量 ${code},5 分钟有效,与插件
  // expiresIn=300s 对齐)。RAM 子账号专用 AK(只授 dysms:SendSms)。
  // 生产 SMS_DELIVERY=aliyun 时四件套必填,见 assertProductionEnv 的条件校验。
  SMS_DELIVERY: z.enum(['capture', 'aliyun']).default('capture'),
  ALIYUN_SMS_ACCESS_KEY_ID: z.string().optional(),
  ALIYUN_SMS_ACCESS_KEY_SECRET: z.string().optional(),
  ALIYUN_SMS_SIGN_NAME: z.string().optional(),
  ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
  DEMO_USER_ID: z.string().default('demo-user-001'),
  DEMO_USER_EMAIL: z.string().default('demo@yujee.local'),
  DEMO_USER_PASSWORD: z.string().min(8).default('demo-password-123'),

  // Vercel cron auth bypass for admin routes (recover-stuck / cleanup-photos).
  // Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron invocations.
  // Unset in dev => cron bypass disabled, so those routes still require admin.
  CRON_SECRET: z.string().optional(),

  // Bootstrap admins without a DB write: any signed-in user whose email is in
  // this comma-separated allowlist is treated as admin, in addition to the
  // users.is_admin flag. Set in the Vercel dashboard (never needs the DB key).
  // Empty => admin gated purely by the flag.
  ADMIN_EMAILS: z.string().optional(),

  // Payment · Creem (海外主通道)
  CREEM_API_KEY: z.string().optional(),
  CREEM_API_BASE_URL: z.string().url().default('https://api.creem.io'),
  CREEM_WEBHOOK_SECRET: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_1: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_4: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_10: z.string().optional(),

  // Payment · Waffo Pancake (海外主通道,2026-08 起替换 Creem;Creem 变量留作在途订单兜底)
  // WAFFO_ENV 决定 webhook 验签用哪把官方公钥 + 拒收错环境事件。
  // 生产必须显式设 'prod',否则 live 事件会被当错环境静默忽略(只扣钱不发积分)。
  WAFFO_MERCHANT_ID: z.string().optional(),
  WAFFO_STORE_ID: z.string().optional(),
  WAFFO_PRIVATE_KEY: z.string().optional(),
  WAFFO_ENV: z.enum(['test', 'prod']).default('test'),
  WAFFO_PRODUCT_ID_PACK_1: z.string().optional(),
  WAFFO_PRODUCT_ID_PACK_4: z.string().optional(),
  WAFFO_PRODUCT_ID_PACK_10: z.string().optional(),

  // Cloudflare R2 (S3-compatible). PDF upload-url uses presigned PUT.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('yujee-pdfs'),

  // S3 兼容存储直连覆盖(国内版:腾讯 COS / 自建 MinIO)。设了 S3_ENDPOINT 就用它
  // 替代 R2_ACCOUNT_ID 拼出的 R2 endpoint;凭证仍复用 R2_ACCESS_KEY_ID /
  // R2_SECRET_ACCESS_KEY(名字带 R2,语义就是 S3 密钥对)。未设则完全走 R2,
  // 海外部署零影响。region 未显式给时从 COS 域名推导(cos.<region>.myqcloud.com)。
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),

  // 生图(AI 图片生成)。国内生产走 kexiang(中转站 SeeDream4.5 异步任务 API,
  // 2026-10-28 起);gemini 是海外历史默认;ark(火山直连)是遗留回退。
  // key 都可缺省:缺了对应 provider 就不可用,生图入口关掉,其余功能不受影响。
  IMAGE_PROVIDER: z.enum(['gemini', 'ark', 'kexiang']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  ARK_API_KEY: z.string().optional(),
  // 生图独立 key:engine 的 ARK_API_KEY 已切中转站(kexiangai),生图仍直连火山
  // seedream,两把 key 不通用;未配时回落 ARK_API_KEY 兼容旧环境。
  ARK_IMAGE_API_KEY: z.string().optional(),
  // kexiang 生图可省:缺省复用 ARK_API_KEY(自动剥 sk- 前缀,任务 API 用原始 key)。
  KEXIANG_API_KEY: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().default('https://cdn.yujeeai.com'),
});

// 下面这些变量在 schema 里都带 dev 兜底默认值(localhost / dev_secret_replace_me 之类),
// 好处是本地零配置起得来,代价是**生产漏配一个变量不会崩,会带着占位值静默上线** ——
// 封面预览那次事故就是这个形状。所以真生产环境下要求它们必须由环境显式提供。
//
// 只在「真生产」生效:
//   - Vercel:  VERCEL_ENV === 'production'(preview/development 保留 dev 默认值,
//              否则每个 PR 预览构建都会因为 Preview 环境本就缺 DATABASE_URL 而炸)
//   - 自托管:  NODE_ENV === 'production' 且没有 VERCEL_ENV(Fly/Docker 等)
const PRODUCTION_REQUIRED = [
  'DATABASE_URL',
  'WEB_BASE_URL',
  'BETTER_AUTH_SECRET',
  'AGENT_BASE_URL',
  'AGENT_SHARED_SECRET',
  'DESIGN_AGENT_BASE_URL',
  'DESIGN_AGENT_SHARED_SECRET',
] as const;

type RawEnv = Record<string, string | undefined>;

export function isRealProduction(raw: RawEnv): boolean {
  if (raw.VERCEL_ENV) return raw.VERCEL_ENV === 'production';
  return raw.NODE_ENV === 'production';
}

export function assertProductionEnv(raw: RawEnv): void {
  if (!isRealProduction(raw)) return;
  const missing = PRODUCTION_REQUIRED.filter((key) => !raw[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `生产环境缺少必需的环境变量: ${missing.join(', ')}。` +
        '这些变量在开发环境有占位默认值,生产环境必须显式设置 —— ' +
        '带着占位值启动会静默连错数据库/错服务。',
    );
  }

  // Waffo 已配置(WAFFO_MERCHANT_ID 非空)却没把 WAFFO_ENV 显式设成 'prod':schema 里
  // WAFFO_ENV 默认 'test'。真实的漏配现场**不是**"mode 门静默 ack"——
  // waffo-service.handleWebhook 调 verifyWebhook 时显式传 { environment: env.WAFFO_ENV },
  // SDK 只会用该环境对应的公钥验签,不会像省略 environment 时那样自动兼容试另一把
  // (见 @waffo/pancake-ts dist/index.js verifyWebhook)。live 事件是拿 prod 私钥签的,
  // 拿 test 公钥验会直接签名失败,waffo-service 捕获后返回 400 + 一行
  // 'waffo webhook signature failed' warn 日志——根本走不到 mode 门那步比较。Waffo
  // 那头对非 2xx 只指数退避重试 3 次,之后整条 delivery 标记 failed:买家扣了钱却
  // 拿不到积分,而且只能去 Waffo dashboard 的 webhook 日志里才看得到这条失败记录。
  // 上线前必须显式设 WAFFO_ENV=prod,不能靠默认值。
  if (raw.WAFFO_MERCHANT_ID?.trim() && raw.WAFFO_ENV !== 'prod') {
    throw new Error(
      '生产环境已配置 WAFFO_MERCHANT_ID 但 WAFFO_ENV 不是 "prod"' +
        `(当前: ${raw.WAFFO_ENV?.trim() ? raw.WAFFO_ENV : '未设置,默认落到 "test"'})。` +
        'verifyWebhook 会用错环境的公钥验签,真实付款 webhook 会签名失败返回 400(而非静默 ack)—— ' +
        'Waffo 重试耗尽后标记 delivery failed,必须显式设 WAFFO_ENV=prod。',
    );
  }

  // WAFFO_STORE_ID 是 webhook 的租户边界安全控制(waffo-service.handleWebhook 的 store
  // 门 fail-closed:未配置就拒收全部事件,不是"配了才校验"的可选项)。真生产已经显式
  // 设对了 WAFFO_ENV=prod,却漏配 WAFFO_STORE_ID:上线后 store 门会把所有付款 webhook
  // 当"未配置"整体拒收,同样不发积分——且不像其它变量那样连错服务,没有明显信号。
  if (raw.WAFFO_MERCHANT_ID?.trim() && raw.WAFFO_ENV === 'prod' && !raw.WAFFO_STORE_ID?.trim()) {
    throw new Error(
      '生产环境已配置 WAFFO_MERCHANT_ID 且 WAFFO_ENV=prod 但缺少 WAFFO_STORE_ID。' +
        'webhook 的 store 门是 fail-closed 安全控制,未配置会拒收所有付款 webhook(不发积分)—— ' +
        '必须显式设置 WAFFO_STORE_ID。',
    );
  }

  // 只配了 CLIP worker 的密钥、却没配它的 base URL:半配等于没配 —— 客户端认的是
  // base URL,secret 单独存在毫无作用,而配置的人显然以为已经开了这条能力。
  // 反过来(只配 base URL)是**合法**的:secret 会回落 AGENT_SHARED_SECRET,
  // 与 engine 的 `grouping_clip_secret or agent_shared_secret` 同一条规则。
  if (raw.AGENT_CLIP_SECRET?.trim() && !raw.AGENT_CLIP_BASE_URL?.trim()) {
    throw new Error(
      '生产环境配了 AGENT_CLIP_SECRET 却没配 AGENT_CLIP_BASE_URL。' +
        '客户端只认 base URL,只配密钥这条抠图 mask 链路根本不会被启用 —— ' +
        '要么两个都配,要么两个都别配。',
    );
  }

  // 短信开关:声称要真实下发却没配齐阿里云四件套 —— 宁可启动即炸,也不要带着
  // 「用户点了获取验证码但永远收不到」的静默故障上线(欠费/漏配是这类故障的
  // 主形状,见 WAFFO 条件校验的同一动机)。SMS_DELIVERY 不设或为 capture 时
  // 四件套可缺(回落 capture 模式,作为阿里云故障期的应急降级通道)。
  if (raw.SMS_DELIVERY === 'aliyun') {
    const smsKeys = [
      'ALIYUN_SMS_ACCESS_KEY_ID',
      'ALIYUN_SMS_ACCESS_KEY_SECRET',
      'ALIYUN_SMS_SIGN_NAME',
      'ALIYUN_SMS_TEMPLATE_CODE',
    ] as const;
    const missingSms = smsKeys.filter((key) => !raw[key]?.trim());
    if (missingSms.length > 0) {
      throw new Error(
        `生产环境 SMS_DELIVERY=aliyun 但缺少阿里云短信配置: ${missingSms.join(', ')}。` +
          '验证码登录/注册验证/手机找回会静默发不出短信 —— 要么配齐四件套,' +
          '要么把 SMS_DELIVERY 降回 capture(应急降级,勿长期停留)。',
      );
    }
  }
}

/**
 * 真生产下的**启动期告警**(不抛,只喊)。
 *
 * 与上面那些 throw 的区别:这些是「能跑,但有一块能力静默降级了」。硬失败不合适 ——
 * 断网/worker 挂了的时候退回兜底仍然强过整个功能不可用;但没有信号就是这批一路在打
 * 的那种病:东西造好了、某一环没接、没人知道。
 */
export function productionWarnings(raw: RawEnv): string[] {
  if (!isRealProduction(raw)) return [];
  const warnings: string[] = [];
  if (!raw.AGENT_CLIP_BASE_URL?.trim()) {
    warnings.push(
      '[config] AGENT_CLIP_BASE_URL 未配置:抠图(cutout)的服务端分割 mask 链路整条不会启用,'
        + '所有抠图会静默退回浏览器端的漫水填充 —— 那是 2026-08-29 实测「棚拍人像 5 张 0 张能用」'
        + '而被否决的算法。用户看到的是被啃残的主体,且没有任何报错。'
        + '要启用请配 AGENT_CLIP_BASE_URL(2GB CLIP worker,不是 AGENT_BASE_URL 那台)。',
    );
  }
  return warnings;
}

assertProductionEnv(process.env);
// 启动期喊一次。console 而不是 pino logger:env 是 logger 的上游依赖,反过来 import
// 会成环;而且这条必须在任何日志配置生效之前就能被看见。
for (const warning of productionWarnings(process.env)) console.warn(warning);

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
