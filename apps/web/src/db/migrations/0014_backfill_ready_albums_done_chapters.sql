-- 存量修复:2026-07 起 applyDesign(选定封面)会把现存章节全部记 done(选完封面导出即解锁)。
-- 在此之前进入 stage='ready' 的相册 progress 里仍留着未 done 的章,导出闸门
-- (allDone && stage='ready')永远打不开。把这些相册的 doneChapterIds 补成全部章节。
-- 幂等:已全 done 的相册重写结果相同。
UPDATE "albums"
SET "draft_json" = jsonb_set(
  jsonb_set(
    "draft_json",
    '{progress,doneChapterIds}',
    COALESCE(
      (
        SELECT jsonb_agg(ch -> 'chapterId')
        FROM jsonb_array_elements("draft_json" -> 'tree' -> 'chapters') AS ch
        WHERE jsonb_typeof(ch -> 'chapterId') = 'string'
      ),
      '[]'::jsonb
    )
  ),
  '{progress,currentChapterId}',
  'null'::jsonb
)
WHERE "stage" = 'ready'
  AND "draft_json" ->> 'version' = 'v3-story'
  AND jsonb_typeof("draft_json" -> 'tree' -> 'chapters') = 'array'
  AND jsonb_typeof("draft_json" -> 'progress') = 'object';
