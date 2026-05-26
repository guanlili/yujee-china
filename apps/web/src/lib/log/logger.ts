type Level = 'info' | 'warn' | 'error' | 'debug';

function log(level: Level, payload: Record<string, unknown>, msg?: string) {
  const line = {
    level,
    time: new Date().toISOString(),
    msg: msg ?? '',
    ...payload,
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const logger = {
  info: (payload: Record<string, unknown>, msg?: string) => log('info', payload, msg),
  warn: (payload: Record<string, unknown>, msg?: string) => log('warn', payload, msg),
  error: (payload: Record<string, unknown>, msg?: string) => log('error', payload, msg),
  debug: (payload: Record<string, unknown>, msg?: string) => log('debug', payload, msg),
};
