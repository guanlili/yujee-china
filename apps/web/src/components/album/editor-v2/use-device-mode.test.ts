import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveDeviceMode } from './mobile-canvas';
import { effectiveViewportWidth } from './use-device-mode';

/* 守卫的是真机抓到的那条:手机横屏时 innerWidth 是 844–932 这类桌面宽度,
   判定掉进 desktop,用户只是把手机转了个方向,界面就换成 5500 行的桌面画布。 */

test('手机横屏仍判 mobile(触摸设备按短边)', () => {
  // iPhone 14 Pro Max 横屏度量
  assert.equal(resolveDeviceMode(effectiveViewportWidth(932, 430, true)), 'mobile');
  // 竖屏不变
  assert.equal(resolveDeviceMode(effectiveViewportWidth(430, 932, true)), 'mobile');
});

test('桌面窄窗口不因短边被误判成手机(鼠标/触控板是 fine 指针)', () => {
  assert.equal(resolveDeviceMode(effectiveViewportWidth(1440, 600, false)), 'desktop');
  assert.equal(resolveDeviceMode(effectiveViewportWidth(900, 500, false)), 'desktop');
});

test('平板横竖屏仍走桌面(短边 820+ 是平板尺寸)', () => {
  assert.equal(resolveDeviceMode(effectiveViewportWidth(1180, 820, true)), 'desktop');
  assert.equal(resolveDeviceMode(effectiveViewportWidth(1024, 1366, true)), 'desktop');
});
