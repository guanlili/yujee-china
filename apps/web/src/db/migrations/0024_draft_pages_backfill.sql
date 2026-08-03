-- draft_pages 拆表(Phase 1a)存量回填:手写数据迁移(非 drizzle-kit 产物)。
-- 把每个相册 albums.draft_json.pages 数组铺成 draft_pages 的逐页行,version 统一
-- 取 1,并把该相册的 draft_revision 置 1(与新写入的行 version 对齐,后续每次
-- draft 写入 +1)。幂等:ON CONFLICT DO NOTHING + WHERE draft_revision = 0 都让
-- 重复执行安全。没有 draft_json.pages 数组的相册(v1/v2、或已是纯 envelope)不受影响。
INSERT INTO draft_pages (album_id, page_index, page, version, updated_by)
SELECT a.id, (p.elem->>'pageIndex')::int, p.elem, 1, NULL
FROM albums a, LATERAL jsonb_array_elements(a.draft_json->'pages') WITH ORDINALITY AS p(elem, ord)
WHERE jsonb_typeof(a.draft_json->'pages') = 'array'
ON CONFLICT (album_id, page_index) DO NOTHING;
--> statement-breakpoint
UPDATE albums SET draft_revision = 1
WHERE draft_revision = 0 AND jsonb_typeof(draft_json->'pages') = 'array';
