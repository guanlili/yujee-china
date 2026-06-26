import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSelectLayoutRequestFromTree } from './generation-service';

const TREE = {
  chapters: [
    {
      chapterId: 'ch_1',
      description: 'Coast morning',
      accentColor: null,
      artFont: null,
      photos: [
        {
          photoId: 'p1',
          sceneDescription: 'beach',
          width: 800,
          height: 600,
          orientation: 'landscape' as const,
          takenAt: '2024-03-15T08:30:00',
        },
        {
          photoId: 'p2',
          sceneDescription: 'portrait',
          width: 600,
          height: 800,
          orientation: 'portrait' as const,
          takenAt: null,
        },
      ],
    },
  ],
};

test('buildSelectLayoutRequestFromTree sends 200px refs and never caller candidates', () => {
  const request = buildSelectLayoutRequestFromTree({
    requestId: 'layout-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    tree: TREE,
    refs: {
      p1: 'data:image/jpeg;base64,AA==',
      p2: 'data:image/jpeg;base64,BB==',
    },
  });

  assert.deepEqual(request, {
    requestId: 'layout-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    chapters: [
      {
        chapterId: 'ch_1',
        structureHint: 'Coast morning',
        photos: [
          {
            photoId: 'p1',
            ref200px: 'data:image/jpeg;base64,AA==',
            orientation: 'landscape',
            takenAt: '2024-03-15T08:30:00',
          },
          {
            photoId: 'p2',
            ref200px: 'data:image/jpeg;base64,BB==',
            orientation: 'portrait',
            takenAt: null,
          },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(request).includes('candidates'), false);
});

test('buildSelectLayoutRequestFromTree requires every tree photo to have a browser 200px ref', () => {
  assert.throws(() =>
    buildSelectLayoutRequestFromTree({
      requestId: 'layout-r1',
      callbackUrl: 'https://web.test/api/v3/internal/job-progress',
      language: 'en',
      tree: TREE,
      refs: { p1: 'data:image/jpeg;base64,AA==' },
    }),
  );
});
