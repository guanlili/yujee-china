import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Locale } from '../../lib/i18n/routing';
import { getMarketingMessages } from './index';

// 这是一组「内容不变量」测试,不是文案快照测试。
//
// 由来:2026-11 改退款政策时,同一件事在五种语言里各说一套 —— zh/en 改成
// 「未使用可全额退」,ja/es/fr 仍写「购后 7 天内可退、超期不退」;定价页还留着
// 「除法律要求外不予退款」。types.ts 只能保证 key 不缺,保证不了语义一致,而这类
// 不一致对用户是实质误导(不同语种看到不同的退款权利)。
//
// 所以这里锁三件事:
//   1. 结构对齐:退款/条款的段落数五语种必须一致,加段漏段会红;
//   2. 废弃说法不许复活:7 天窗口、30 天自动清理、一律不退;
//   3. 主体与币种:法律页的运营主体只有一个来源,站内不许出现人民币符号。

const LOCALES: Locale[] = ['zh', 'en', 'ja', 'es', 'fr'];

/** 已废弃的退款窗口说法(2026-11-14 统一为「整单未使用全额退」,不设时限)。 */
const REFUND_WINDOW_PHRASES = [
  '7 天内',
  '7 日以内',
  '7 日を超え',
  'within 7 days',
  'dentro de 7 días',
  'sous 7 jours',
  '3 个工作日',
  '3 営業日',
  '3 días laborables',
  '3 jours ouvrés',
];

/** 已废弃的「一律不退」说法(条款 §7 / 定价页 refundBody 曾各写一套)。 */
const BLANKET_NO_REFUND_PHRASES = [
  '一律不予退还',
  '除法律要求外不予退款',
  '除いて返金はできません',
  'salvo donde la ley obligue',
  'sauf lorsque la loi l’exige',
  'non-refundable except where the law',
];

/** 隐私页曾承诺「失败任务 30 天后自动清理」,但线上没有任何定时任务在跑。 */
const AUTOMATIC_CLEANUP_PHRASES = ['30 天后自动清理', 'automatically after 30 days'];

function marketingText(locale: Locale): string {
  // 整个语种的文案拼成一段文本,关键词扫描不必关心它落在哪个字段。
  return JSON.stringify(getMarketingMessages(locale));
}

test('退款政策段落数五语种一致', () => {
  const base = getMarketingMessages('zh').refund.sections.length;
  assert.ok(base > 0);
  for (const locale of LOCALES) {
    assert.equal(
      getMarketingMessages(locale).refund.sections.length,
      base,
      `${locale} 的退款政策段落数与 zh 不一致 —— 多半是某语种漏改了`,
    );
  }
});

test('服务条款段落数五语种一致', () => {
  const base = getMarketingMessages('zh').terms.sections.length;
  for (const locale of LOCALES) {
    assert.equal(
      getMarketingMessages(locale).terms.sections.length,
      base,
      `${locale} 的服务条款段落数与 zh 不一致`,
    );
  }
});

test('退款页不得复活 7 天窗口与回复 SLA', () => {
  for (const locale of LOCALES) {
    const refund = JSON.stringify(getMarketingMessages(locale).refund);
    for (const phrase of REFUND_WINDOW_PHRASES) {
      assert.ok(
        !refund.includes(phrase),
        `${locale} 的退款页仍含废弃说法「${phrase}」—— 统一口径是不设期限、尽快回复`,
      );
    }
  }
});

test('定价页与条款不得复活「一律不退」', () => {
  for (const locale of LOCALES) {
    const messages = getMarketingMessages(locale);
    const combined = `${messages.pricingPage.refundBody}\n${JSON.stringify(messages.terms)}`;
    for (const phrase of BLANKET_NO_REFUND_PHRASES) {
      assert.ok(
        !combined.includes(phrase),
        `${locale} 仍含「${phrase}」—— 退款口径应与《退款政策》一致`,
      );
    }
  }
});

test('隐私政策不得承诺未实现的「自动清理」', () => {
  for (const locale of LOCALES) {
    const privacy = JSON.stringify(getMarketingMessages(locale).privacy);
    for (const phrase of AUTOMATIC_CLEANUP_PHRASES) {
      assert.ok(
        !privacy.includes(phrase),
        `${locale} 的隐私政策仍写「${phrase}」—— 线上没有对应的定时任务`,
      );
    }
  }
});

test('法律页的运营主体只有一个来源,且五语种都写得出', async () => {
  const { OPERATOR_ENTITY, operatorLine } = await import('../../config/operator');
  assert.equal(OPERATOR_ENTITY, '北京知景方略信息科技有限责任公司');
  for (const locale of LOCALES) {
    const line = operatorLine(locale);
    assert.ok(line.includes(OPERATOR_ENTITY), `operatorLine(${locale}) 没有带主体名`);
    assert.ok(line.length > OPERATOR_ENTITY.length, `operatorLine(${locale}) 只有主体名,缺语种前缀`);
  }
});

test('中文文案不出现人民币符号(人民币价由 env 注入,未配置前不展示)', () => {
  const text = marketingText('zh');
  assert.ok(!text.includes('¥'), '中文文案出现 ¥ —— 未定价前不得展示人民币金额');
});
