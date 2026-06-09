import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERRORS, mapAgentErrorCode } from './error-codes';

// rebuild-tech-plan §1.6 (P2-8): the agent's contract.md §8 namespace is mapped
// to the error-codes.ts namespace at the inbound callback boundary.
test('mapAgentErrorCode: AGENT_OUTPUT_VALIDATION → AGENT_INVALID_OUTPUT', () => {
  assert.equal(mapAgentErrorCode('AGENT_OUTPUT_VALIDATION'), 'AGENT_INVALID_OUTPUT');
});

test('mapAgentErrorCode: shared codes pass through unchanged', () => {
  for (const code of [
    'AGENT_VISION_FAILED',
    'AGENT_PLANNING_FAILED',
    'AGENT_TIMEOUT',
    'AGENT_CHAT_FAILED',
    'AGENT_INTERNAL_ERROR',
  ]) {
    assert.equal(mapAgentErrorCode(code), code);
  }
});

test('mapAgentErrorCode: the mapped target is a real error-codes.ts code', () => {
  // AGENT_INVALID_OUTPUT exists in ERRORS; ALBUM_BUSY does NOT (not introduced).
  assert.equal(ERRORS.AGENT_INVALID_OUTPUT().code, 'AGENT_INVALID_OUTPUT');
  assert.ok(!('ALBUM_BUSY' in ERRORS), 'ALBUM_BUSY must not be introduced (§1.6)');
  // v2 concurrency / non-EDITING conflicts reuse ALBUM_NOT_EDITABLE (409).
  assert.equal(ERRORS.ALBUM_NOT_EDITABLE().code, 'ALBUM_NOT_EDITABLE');
  assert.equal(ERRORS.ALBUM_NOT_EDITABLE().status, 409);
});

test('mapAgentErrorCode: unknown code is returned verbatim (no swallowing)', () => {
  assert.equal(mapAgentErrorCode('SOMETHING_NEW'), 'SOMETHING_NEW');
});
