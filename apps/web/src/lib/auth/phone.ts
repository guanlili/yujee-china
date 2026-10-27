// 手机号归一的唯一真相:服务端 /phone-signup、找回密码,与前端表单
// (register/login/forgot-password)共用。
// 必须共用的原因:/sign-in/phone-number 是**精确匹配**查询(插件不做归一),而注册
// 端归一后落库 —— 注册带 "+86"、登录不带就会查无此人。同一函数进同一路径,才不会
// 两端口径漂移。此处保持纯函数:客户端组件也 import 它,不能带任何服务端依赖。

/** 归一:去空格/连字符/括号,认 `+` 开头 5-15 位数字;其余一律拒。 */
export function normalizePhoneNumber(input: string): string | null {
  const trimmed = input.replace(/[\s\-()]/g, '');
  return /^(\+?\d{5,15})$/.test(trimmed) ? trimmed : null;
}
