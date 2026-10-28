// 手机号归一的唯一真相:服务端 /phone-signup、/phone-number/send-otp、找回密码,
// 与前端表单(register/login/forgot-password)共用。
// 必须共用的原因:/sign-in/phone-number、/phone-number/verify 是**精确匹配**查询
// (插件不做归一),而注册端归一后落库 —— 两端口径漂移就会「注册得了、登不回」。
// 同一函数进同一路径,才不会漂移。此处保持纯函数:客户端组件也 import 它,不能带
// 任何服务端依赖。

/**
 * 归一:去空格/连字符/括号,剥 `+86` 前缀,认大陆 11 位手机号(`1[3-9]` 开头);
 * 其余一律拒(港澳台/国际号后续迭代再放开,D5)。
 * 存量 `+86…` 混格式数据由 0034 迁移收敛,与本函数新口径对齐。
 */
export function normalizePhoneNumber(input: string): string | null {
  const trimmed = input.replace(/[\s\-()]/g, '');
  const bare = trimmed.startsWith('+86') ? trimmed.slice(3) : trimmed;
  return /^1[3-9]\d{9}$/.test(bare) ? bare : null;
}
