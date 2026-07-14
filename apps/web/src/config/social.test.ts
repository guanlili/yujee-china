import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOCIAL_LINKS, SUPPORT_EMAIL } from './social';

// The footer once shipped five social icons all pointing at href="#" plus a Weibo
// icon pointing at weibo.com's homepage — every one dead on click. The contract
// now is: an entry either has a real profile URL or it is not rendered. There is
// no third state, and a placeholder must never sneak back in.
test('no social entry carries a placeholder href', () => {
  for (const s of SOCIAL_LINKS) {
    assert.notEqual(s.href, '#', `${s.label} uses "#" — render nothing instead`);
    if (s.href === '') continue; // no account yet — MarketingSocials skips it

    assert.match(s.href, /^https:\/\//, `${s.label} must be a full https URL`);
    // A bare platform homepage is not an account.
    const bareHomepages = [
      'https://weibo.com',
      'https://x.com',
      'https://twitter.com',
      'https://instagram.com',
      'https://youtube.com',
      'https://tiktok.com',
      'https://discord.com',
    ];
    for (const home of bareHomepages) {
      assert.notEqual(
        s.href.replace(/\/$/, ''),
        home,
        `${s.label} points at the platform homepage, not an account`,
      );
    }
  }
});

test('every social entry has an icon path and a label', () => {
  for (const s of SOCIAL_LINKS) {
    assert.ok(s.label.length > 0);
    assert.ok(s.path.length > 0, `${s.label} has no icon path`);
  }
});

test('support email is a real address', () => {
  assert.match(SUPPORT_EMAIL, /^[^@\s]+@yujeeai\.com$/);
});
