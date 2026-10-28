// 短信 OTP 发送统一入口 —— 镜像 lib/email/send-email.ts 的三态开关模式(这里是
// 两态:capture | aliyun)。better-auth 的 sendOTP / sendPasswordResetOTP 两个回调
// 与自定义注册发码端点是仅有的三个调用方;验证码的生成/存储/验码/限次全部由
// better-auth phoneNumber 插件负责,这里只管「把码送到用户手机上」。
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '@/lib/env';
import { sendSmsViaAliyun } from './aliyun-sms';

/** scene 只影响日志与 capture 行的标注;模板登录/注册/找回共用一个(§3.4)。 */
export type SmsScene = 'login' | 'signup' | 'reset';
export type SmsDelivery = 'capture' | 'aliyun';

export type SendSmsInput = {
  phoneNumber: string;
  code: string;
  scene: SmsScene;
};

export async function sendSms(input: SendSmsInput): Promise<void> {
  await dispatchSms(env.SMS_DELIVERY, input);
}

// dispatchSms 与 sendSms 分开:单测不碰 process.env(解析后的 env 单例在 import 时
// 定型),直接对 delivery 分派断言行为。
export async function dispatchSms(delivery: SmsDelivery, input: SendSmsInput): Promise<void> {
  if (delivery === 'aliyun') {
    await sendSmsViaAliyun(input);
    return;
  }
  await captureSmsOtp(input);
}

// capture 模式:验证码写 EMAIL_CAPTURE_FILE —— 本地开发、CI 测试、以及「代码先
// 上线、密钥后配」的灰度窗口全靠它。kind 沿用 phone-otp / phone-otp-reset 两值
// (better-auth.test.ts 与 phone-password-reset.test.ts 按这两个 kind 捞码,契约
// 不能变);scene 字段区分 login/signup(共用 phone-otp kind)。
async function captureSmsOtp(input: SendSmsInput): Promise<void> {
  const kind = input.scene === 'reset' ? 'phone-otp-reset' : 'phone-otp';
  const capturePath = resolve(process.cwd(), env.EMAIL_CAPTURE_FILE);
  await mkdir(dirname(capturePath), { recursive: true });
  await appendFile(
    capturePath,
    `${JSON.stringify({
      kind,
      scene: input.scene,
      phoneNumber: input.phoneNumber,
      code: input.code,
      capturedAt: new Date().toISOString(),
    })}\n`,
    'utf8',
  );
}
