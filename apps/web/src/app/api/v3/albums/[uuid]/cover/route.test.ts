import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBrowserCoverPatch } from './route-utils';
import type { V3LayoutPatchEntry } from '@yujee/contracts';

test('toBrowserCoverPatch converts agent images/texts to browser imagesJson/textsJson', () => {
  const agentPatch: V3LayoutPatchEntry[] = [
    {
      pageIndex: 0,
      templateId: 'mag-01',
      images: { image: 'p1' },
      texts: { folio: '01' },
    },
  ];

  assert.deepEqual(toBrowserCoverPatch(agentPatch), [
    {
      pageIndex: 0,
      templateId: 'mag-01',
      imagesJson: { image: 'p1' },
      textsJson: { folio: '01' },
    },
  ]);
});

test('toBrowserCoverPatch preserves absent optional patch fields as absent', () => {
  assert.deepEqual(toBrowserCoverPatch([{ pageIndex: 2, templateId: 'mag-20' }]), [
    { pageIndex: 2, templateId: 'mag-20' },
  ]);
});
