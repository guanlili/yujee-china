import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, describe, it } from 'node:test';

import { env } from '@/lib/env';
import {
  maskPhoneNumber,
  sendSmsViaAliyun,
  setAliyunSmsTransportForTest,
  type AliyunSmsTransport,
} from './aliyun-sms';
import { dispatchSms } from './send-sms';

// 短信分派与阿里云封装的单测(mock transport,不碰 SDK/网络/真密钥)。
// capture 模式写 EMAIL_CAPTURE_FILE(与既有 better-auth/phone-password-reset
// 测试同一个文件约定,用唯一手机号过滤断言)。

type CapturedRow = { kind?: string; scene?: string; phoneNumber?: string; code?: string; capturedAt?: string };

function captureRows(phone: string): CapturedRow[] {
  let text = '';
  try {
    text = readFileSync(resolve(process.cwd(), env.EMAIL_CAPTURE_FILE), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedRow)
    .filter((row) => row.phoneNumber === phone);
}

function fakeTransport(
  body: { code?: string; message?: string; bizId?: string },
): { transport: AliyunSmsTransport; requests: Array<Record<string, unknown>> } {
  const requests: Array<Record<string, unknown>> = [];
  const transport: AliyunSmsTransport = {
    async sendSms(request) {
      requests.push({ ...request });
      return { body };
    },
  };
  return { transport, requests };
}

describe('maskPhoneNumber(日志脱敏)', () => {
  it('keeps head 3 and tail 2, masks the middle', () => {
    assert.equal(maskPhoneNumber('13812345678'), '138****78');
    assert.equal(maskPhoneNumber('13900000000'), '139****00');
  });

  it('fully masks short inputs', () => {
    assert.equal(maskPhoneNumber('12345'), '***');
    assert.equal(maskPhoneNumber(''), '***');
  });
});

describe('dispatchSms(capture 模式)', () => {
  it('login/signup scenes share kind=phone-otp; reset uses phone-otp-reset', async () => {
    const phone = `136${String(Date.now()).slice(-8)}`;
    await dispatchSms('capture', { phoneNumber: phone, code: '123456', scene: 'login' });
    await dispatchSms('capture', { phoneNumber: phone, code: '654321', scene: 'signup' });
    await dispatchSms('capture', { phoneNumber: phone, code: '999999', scene: 'reset' });

    const rows = captureRows(phone);
    assert.deepEqual(
      rows.map((row) => ({ kind: row.kind, scene: row.scene, code: row.code })),
      [
        { kind: 'phone-otp', scene: 'login', code: '123456' },
        { kind: 'phone-otp', scene: 'signup', code: '654321' },
        { kind: 'phone-otp-reset', scene: 'reset', code: '999999' },
      ],
    );
    assert.ok(rows.every((row) => typeof row.capturedAt === 'string' && row.capturedAt.length > 0));
  });
});

describe('dispatchSms(aliyun 模式,mock transport)', () => {
  after(() => setAliyunSmsTransportForTest(null));

  it('resolves on OK and shapes the request as the plugin OTP contract expects', async () => {
    const { transport, requests } = fakeTransport({ code: 'OK', message: 'OK', bizId: 'biz-123' });
    setAliyunSmsTransportForTest(transport);
    await dispatchSms('aliyun', { phoneNumber: '13812345678', code: '246810', scene: 'login' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.phoneNumbers, '13812345678');
    assert.equal(requests[0]?.templateParam, '{"code":"246810"}');
    // 验证码明文只允许进 templateParam 与 capture 文件;signName/templateCode
    // 取自 env(测试进程未配 => undefined,生产由 assertProductionEnv 把关)。
  });

  it('fails loudly when SMS_DELIVERY=aliyun but the aliyun config is missing', async () => {
    // env 单例在测试进程里是 capture 口径(SMS_DELIVERY 默认 capture,四件套未配),
    // sendSmsViaAliyun 的配置读取走 env —— 缺件套必须炸清晰错误,而不是静默
    // 走 capture(那等于「以为发了其实没发」)。
    setAliyunSmsTransportForTest(null);
    await assert.rejects(
      () => sendSmsViaAliyun({ phoneNumber: '13800000000', code: '123456', scene: 'login' }),
      /ALIYUN_SMS/,
      'missing aliyun config must fail loudly',
    );
  });

  it('maps provider rate-limit codes to 429 and logs no code plaintext', async () => {
    const { transport } = fakeTransport({ code: 'isv.BUSINESS_LIMIT_CONTROL', message: 'Flow limited' });
    setAliyunSmsTransportForTest(transport);
    await assert.rejects(
      () => dispatchSms('aliyun', { phoneNumber: '13812345678', code: '246810', scene: 'login' }),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 429);
        return true;
      },
      'isv.BUSINESS_LIMIT_CONTROL must surface as TOO_MANY_REQUESTS',
    );
    const { transport: dayLimit } = fakeTransport({ code: 'isv.DAY_LIMIT_CONTROL', message: 'Day limited' });
    setAliyunSmsTransportForTest(dayLimit);
    await assert.rejects(
      () => dispatchSms('aliyun', { phoneNumber: '13812345678', code: '246810', scene: 'reset' }),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 429);
        return true;
      },
    );
  });

  it('maps out-of-balance and config errors to 500(欠费属静默故障,必须可从日志定位)', async () => {
    const { transport: broke } = fakeTransport({ code: 'isv.AMOUNT_NOT_ENOUGH', message: 'Insufficient balance' });
    setAliyunSmsTransportForTest(broke);
    await assert.rejects(
      () => dispatchSms('aliyun', { phoneNumber: '13812345678', code: '246810', scene: 'login' }),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 500);
        return true;
      },
    );
    const { transport: badSign } = fakeTransport({ code: 'isv.SMS_SIGNATURE_ILLEGAL', message: 'Bad sign' });
    setAliyunSmsTransportForTest(badSign);
    await assert.rejects(
      () => dispatchSms('aliyun', { phoneNumber: '13812345678', code: '246810', scene: 'login' }),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 500);
        return true;
      },
    );
  });

  it('network/SDK failures map to 500 without retry', async () => {
    setAliyunSmsTransportForTest({
      async sendSms() {
        throw new Error('socket timeout');
      },
    });
    await assert.rejects(
      () => dispatchSms('aliyun', { phoneNumber: '13812345678', code: '246810', scene: 'login' }),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 500);
        return true;
      },
    );
  });
});
