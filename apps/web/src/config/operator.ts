import type { Locale } from '@/lib/i18n/routing';

/**
 * 站点运营主体(唯一来源)。
 *
 * 经营者提供的主体名称,页脚、服务条款、隐私政策、购买页共用这一处,避免四个
 * 页面各写一遍然后写法漂移。
 *
 * **注意**:工信部备案号(见 `beian.ts`)目前是个人主体,与这里的企业主体不是同一
 * 件事。代码只能如实并列展示,不能把个人备案改写成企业备案——那属于备案主体变更,
 * 必须走工信部流程。上线前由负责人确认该主体确实承担经营、收款与用户服务责任。
 */
export const OPERATOR_ENTITY = '北京知景方略信息科技有限责任公司';

const PREFIX: Record<Locale, string> = {
  zh: '运营与服务提供方',
  en: 'Operated and provided by',
  ja: '運営・サービス提供',
  es: 'Operado y prestado por',
  fr: 'Exploité et fourni par',
};

export function operatorLine(locale: Locale): string {
  return `${PREFIX[locale]}:${OPERATOR_ENTITY}`;
}
