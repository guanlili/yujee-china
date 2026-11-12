type Level = 'info' | 'warn' | 'error' | 'debug';

/** 日志输出目的地。测试里可替换成静默实现,避免「构造出来的告警」串进 CI 日志。 */
type Sink = (level: Level, line: string) => void;

function consoleSink(level: Level, line: string) {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

let sink: Sink = consoleSink;

function log(level: Level, payload: Record<string, unknown>, msg?: string) {
  const line = {
    level,
    time: new Date().toISOString(),
    msg: msg ?? '',
    ...payload,
  };
  sink(level, JSON.stringify(line));
}

export const logger = {
  info: (payload: Record<string, unknown>, msg?: string) => log('info', payload, msg),
  warn: (payload: Record<string, unknown>, msg?: string) => log('warn', payload, msg),
  error: (payload: Record<string, unknown>, msg?: string) => log('error', payload, msg),
  debug: (payload: Record<string, unknown>, msg?: string) => log('debug', payload, msg),
};

/**
 * 仅测试用:把日志接到别处(传 null 恢复控制台)。
 *
 * 动机(2026-11-11):`send-sms.test.ts` 里有用例故意让阿里云返回
 * `isv.AMOUNT_NOT_ENOUGH`,断言欠费时的降级与告警语义。它会打出一条
 * `sms.send.fail: 阿里云短信账户欠费,已停发` 的 error 日志 —— 那条日志在 CI
 * 输出里和真实故障长得一模一样,已经误导过一次排查(被当成线上真的欠费)。
 * 测试传一个空 sink 即可让它闭嘴,用例本身的断言不变。
 */
export function setLoggerSinkForTest(next: Sink | null) {
  sink = next ?? consoleSink;
}
