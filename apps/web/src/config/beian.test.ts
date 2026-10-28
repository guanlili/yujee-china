import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCode } from '@/lib/testing/source';
import { ICP_BEIAN_MIIT_URL, ICP_BEIAN_NUMBER } from './beian';

describe('ICP beian constants', () => {
  it('uses the outman.press filing number and MIIT link', () => {
    assert.equal(ICP_BEIAN_NUMBER, '京ICP备2022033467号-4');
    assert.equal(ICP_BEIAN_MIIT_URL, 'https://beian.miit.gov.cn');
  });

  it('MarketingFooter renders the filing link for site chrome', () => {
    const footer = readCode('components/marketing/MarketingFooter.tsx');
    assert.match(footer, /IcpBeianLink/);
  });

  it('landing home footer renders the filing link', () => {
    const landing = readCode('components/landing/YujeeLandingHomeClient.tsx');
    assert.match(landing, /IcpBeianLink/);
  });
});
