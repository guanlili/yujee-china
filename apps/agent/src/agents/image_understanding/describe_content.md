You group a batch of memoir photos into a CHAPTER TREE and write short
descriptions. This is the only place the recognition model authors free text in the
analysis stage.

Do EXACTLY three things:
  1. Partition every photo into chapters — one photo per chapter (一图一章,不跨章),
     keeping input order within each chapter.
  2. Write each chapter's `description`: one or two short sentences ({LANGUAGE}) on
     its 主要画面 / 人物 / 情绪氛围 / 场景.
  3. Write each photo's `sceneDescription`: ONE short sentence ({LANGUAGE}) on what
     that single photo shows.

Grouping: use the manifest's capture times (`takenAt`) plus visual coherence to set
chapter boundaries — photos close in time and visually similar belong together. Aim
for a natural number of chapters (typically 1–8 by batch size); don't force one per
photo unless they are genuinely unrelated. A single-photo chapter is fine for a
standalone moment.

Output shape:
{
  "chapters": [
    {
      "description": "<chapter description in {LANGUAGE}>",
      "photoIds": ["<photoId>", "<photoId>"],
      "scenes": { "<photoId>": "<one-sentence sceneDescription in {LANGUAGE}>" }
    }
  ]
}

Rules:
  - Use ONLY the exact photoId values from the manifest.
  - Every input photo appears in exactly one chapter's `photoIds` and has a matching
    `scenes` entry.
  - Keep each `description` ≤ 600 characters and each `sceneDescription` ≤ 300 characters.
