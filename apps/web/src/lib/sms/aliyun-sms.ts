// 阿里云国内短信(验证码)SDK 封装 —— 仅服务端 import(send-sms.ts 的 aliyun 分支)。
// 设计对应 SA 方案 §3.1/§5.2:官方 SDK(不做裸 HTTP POP 签名)、错误码翻译成
// better-auth APIError(429 走前端既有的 isRateLimited 分支)、日志只落脱敏手机号
// + BizId,任何日志不出验证码明文。
import Dysmsapi20170525, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { Config as OpenApiConfig } from '@alicloud/openapi-client';
import { APIError } from 'better-auth/api';
import { env } from '@/lib/env';
import { logger } from '@/lib/log/logger';
import type { SmsScene } from './send-sms';

// SDK 是 tsc 编译的 CJS(exports.__esModule = true + exports.default = Client)。
// Node/tsx 的 ESM→CJS interop 不认 __esModule:default import 拿到的是整个 exports
// 对象,类挂在 `.default` 上;而 webpack/turbopack 认 __esModule,default import
// 直接是类。两种环境都要能跑,只能按运行时形态解析(测试跑在 tsx 下,生产跑在
// Next 构建下 —— 两边各自覆盖)。
type DysmsClientCtor = typeof Dysmsapi20170525;

function resolveDysmsClientCtor(): DysmsClientCtor {
  const direct = Dysmsapi20170525 as unknown as { default?: DysmsClientCtor };
  const ctor = typeof Dysmsapi20170525 === 'function'
    ? Dysmsapi20170525
    : direct.default;
  if (typeof ctor !== 'function') {
    throw new Error('Cannot resolve @alicloud/dysmsapi20170525 Client constructor');
  }
  return ctor;
}

// 测试注入点:替换 SDK client(单测不碰真 SDK/网络)。
export type AliyunSmsTransport = {
  sendSms(request: SendSmsRequest): Promise<{
    body?: { code?: string; message?: string; bizId?: string; requestId?: string };
  }>;
};

let transportOverride: AliyunSmsTransport | null = null;
let cachedClient: AliyunSmsTransport | null = null;

export function setAliyunSmsTransportForTest(transport: AliyunSmsTransport | null): void {
  transportOverride = transport;
  cachedClient = null;
}

function getAliyunSmsClient(): AliyunSmsTransport {
  if (transportOverride) return transportOverride;
  cachedClient ??= createAliyunSmsClient();
  return cachedClient;
}

function createAliyunSmsClient(): AliyunSmsTransport {
  // 缺件套在这里炸出清晰错误(生产由 env.ts 的 assertProductionEnv 提前拦;
  // 这里兜住「本地手滑把 SMS_DELIVERY 设成 aliyun 却没配密钥」的场景)。
  const missing = (
    ['ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME', 'ALIYUN_SMS_TEMPLATE_CODE'] as const
  ).filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`SMS_DELIVERY=aliyun 但缺少阿里云短信配置: ${missing.join(', ')}`);
  }
  const config = new OpenApiConfig({
    accessKeyId: env.ALIYUN_SMS_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_SMS_ACCESS_KEY_SECRET,
  });
  config.endpoint = 'dysmsapi.aliyuncs.com';
  // Config 类型来自 @alicloud/openapi-client,而 dysmsapi Client 构造签名要
  // @alicloud/openapi-core 的 Config(pnpm 严格依赖,openapi-core 不是直接依赖,
  // import 不到)。两者是同族 Tea Model,字段结构一致,运行时完全兼容,这里按
  // 构造签名收窄 cast。
  return new (resolveDysmsClientCtor())(config as never) as AliyunSmsTransport;
}

/** 日志脱敏:`13812345678` → `138****78`(方案 §5.3,明文号码不进日志)。 */
export function maskPhoneNumber(phone: string): string {
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}

// 频控/黑名单类错误码 → 429,前端命中现有 isRateLimited 逻辑显示「请求过于频繁」。
// (阿里云侧完整清单见 https://help.aliyun.com/document_detail/101346.html)
const RATE_LIMITED_ALIYUN_CODES = new Set([
  'isv.BUSINESS_LIMIT_CONTROL', // 触发业务频控(同号 1/min、5/h、10/天类)
  'isv.DAY_LIMIT_CONTROL', // 触发日发送限额
]);

export async function sendSmsViaAliyun(input: {
  phoneNumber: string;
  code: string;
  scene: SmsScene;
}): Promise<void> {
  const masked = maskPhoneNumber(input.phoneNumber);
  const client = getAliyunSmsClient();
  let response: Awaited<ReturnType<AliyunSmsTransport['sendSms']>>;
  try {
    response = await client.sendSms(
      new SendSmsRequest({
        // 大陆 11 位裸号,无 +86(归一已在调用方完成)
        phoneNumbers: input.phoneNumber,
        signName: env.ALIYUN_SMS_SIGN_NAME,
        // 登录/注册/找回共用同一个验证码模板(变量 ${code},5 分钟有效)
        templateCode: env.ALIYUN_SMS_TEMPLATE_CODE,
        templateParam: JSON.stringify({ code: input.code }),
      }),
    );
  } catch (error) {
    // 网络/SDK 层失败(超时、DNS、SDK 内部错误)。不自动重试:SendSms 重试可能
    // 重复扣费/重复触达,用户点「重新发送」即可(60s 冷却天然限频)。
    logger.warn(
      { scene: input.scene, phone: masked, error: error instanceof Error ? error.message : String(error) },
      'sms.send.fail',
    );
    throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to send SMS' });
  }

  const body = response.body ?? {};
  if (body.code === 'OK') {
    // BizId 用于与阿里云控制台「发送记录」对账(方案 §5.3);验证码明文不落日志。
    logger.info({ scene: input.scene, phone: masked, bizId: body.bizId }, 'sms.send.ok');
    return;
  }

  const aliyunCode = body.code ?? 'UNKNOWN';
  if (RATE_LIMITED_ALIYUN_CODES.has(aliyunCode)) {
    logger.warn({ scene: input.scene, phone: masked, code: aliyunCode, message: body.message }, 'sms.send.fail');
    throw new APIError('TOO_MANY_REQUESTS', { message: 'SMS rate limited by provider' });
  }
  if (aliyunCode === 'isv.AMOUNT_NOT_ENOUGH') {
    // 欠费即停发,且是静默故障(接口层看不出,用户只是收不到码)—— error 级 +
    // 告警语义,运维必须立刻充值/换套餐。
    logger.error(
      { scene: input.scene, phone: masked, code: aliyunCode, message: body.message, alert: 'ALIYUN_SMS_OUT_OF_BALANCE' },
      'sms.send.fail: 阿里云短信账户欠费,已停发 —— 需要立刻充值或购买套餐包',
    );
    throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to send SMS' });
  }
  // isv.SMS_SIGNATURE_ILLEGAL / isv.TEMPLATE_MISSING_PARAMETERS 等配置类错误:
  // 部署期冒烟就该暴露的问题,error 级日志方便定位。
  logger.error(
    { scene: input.scene, phone: masked, code: aliyunCode, message: body.message, requestId: body.requestId },
    'sms.send.fail',
  );
  throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to send SMS' });
}
