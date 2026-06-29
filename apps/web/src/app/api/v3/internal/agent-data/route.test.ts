import assert from 'node:assert/strict';
import test from 'node:test';

import { V3InternalAgentDataRequest } from '@yujee/contracts';
import { env } from '@/lib/env';
import { parseAgentDataRequest } from './handler';
import { GET } from './route';

test('internal agent-data parser covers page-info, chapter-search, and page-photos', () => {
  assert.deepEqual(
    parseAgentDataRequest(
      new URL('http://web.test/api/v3/internal/agent-data?type=page-info&albumId=a1&scope=page&chapterId=c1&pageIndex=2'),
    ),
    { type: 'page-info', albumId: 'a1', scope: 'page', chapterId: 'c1', pageIndex: 2 },
  );
  assert.equal(
    V3InternalAgentDataRequest.safeParse(
      parseAgentDataRequest(
        new URL('http://web.test/api/v3/internal/agent-data?type=page-info&albumId=a1&scope=page&chapterId=c1&pageIndex=2'),
      ),
    ).success,
    true,
  );

  assert.deepEqual(
    parseAgentDataRequest(
      new URL('http://web.test/api/v3/internal/agent-data?type=chapter-search&albumId=a1&query=coast&limit=3'),
    ),
    { type: 'chapter-search', albumId: 'a1', query: 'coast', limit: 3 },
  );

  assert.deepEqual(
    parseAgentDataRequest(
      new URL('http://web.test/api/v3/internal/agent-data?type=page-photos&albumId=a1&chapterId=c1'),
    ),
    { type: 'page-photos', albumId: 'a1', chapterId: 'c1' },
  );
});

test('internal agent-data parser rejects missing fields for each request type', () => {
  assert.throws(() =>
    parseAgentDataRequest(
      new URL('http://web.test/api/v3/internal/agent-data?type=page-info&albumId=a1&scope=page&chapterId=c1'),
    ),
  );
  assert.throws(() =>
    parseAgentDataRequest(
      new URL('http://web.test/api/v3/internal/agent-data?type=chapter-search&albumId=a1&query='),
    ),
  );
  assert.throws(() =>
    parseAgentDataRequest(
      new URL('http://web.test/api/v3/internal/agent-data?type=page-photos&albumId=a1'),
    ),
  );
});

test('internal agent-data route rejects wrong shared bearer', async () => {
  const res = await GET(
    new Request('http://web.test/api/v3/internal/agent-data?type=page-photos&albumId=a1&chapterId=c1', {
      headers: { Authorization: `Bearer ${env.AGENT_SHARED_SECRET}-wrong` },
    }),
  );

  assert.equal(res.status, 401);
});
