import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '[locale]', 'my-albums', 'page.tsx'), 'utf8');
const coverPreview = readFileSync(join(here, '..', 'components', 'album', 'AlbumCoverPreview.tsx'), 'utf8');

const getRunningBranch = () => {
  const match = page.match(/if \(a\.status === 'AGENT_RUNNING'\) \{([\s\S]*?)\n    if \(a\.status === 'FAILED'\)/);
  assert.ok(match, 'AGENT_RUNNING branch should exist');
  return match[1];
};

const getFailedBranch = () => {
  const match = page.match(/if \(a\.status === 'FAILED'\) \{([\s\S]*?)\n    \/\/ COMPLETED \/ EDITING/);
  assert.ok(match, 'FAILED branch should exist');
  return match[1];
};

test('my-albums uses the supplied standalone Yujee gallery shell', () => {
  assert.doesNotMatch(page, /<AppChrome/, 'the page should not be wrapped in the old dashboard shell');
  assert.doesNotMatch(page, /from '@\/components\/app\/AppChrome'/);
  assert.match(page, /className="page-glow"/, 'top holographic glow from the supplied design should render');
  assert.match(page, /className="nav-shell fixed left-0 right-0 top-0 z-50/, 'top chrome should stay pinned while the album grid scrolls');
  assert.match(page, /<main className="relative z-10 mx-auto max-w-\[1320px\][^"]*pt-\[120px\]/, 'main content should reserve space under the fixed top chrome');
  assert.match(page, /<Brand href=\{`\/\$\{locale\}`\} markSize=\{24\} \/>/, 'top nav logo should use the supplied compact 24px mark size');
  assert.match(page, /activeNav="projects"|aria-current=\{active \? 'page'/, 'left capsule projects nav should still expose current-page state');
});

test('my-albums cards match the poster-grid design states', () => {
  assert.match(page, /album-poster-card/g, 'create and album entries should share one poster-card shell');
  assert.match(page, /grid grid-cols-2 gap-x-6 gap-y-8/, 'mobile grid should keep visible gutters between cards');
  assert.match(page, /sm:gap-x-7 sm:gap-y-9/, 'desktop grid should keep generous poster gutters');
  assert.match(page, /aspect-\[3\/4\]/, 'album covers should use the supplied tall poster ratio');
  assert.match(page, /cover-kicker/, 'completed cards should keep the small category kicker');
  assert.match(page, /cover-title/, 'completed cards should overlay the album title on the cover');
  assert.match(page, /album-status-chip/, 'status chips should use a shared pill treatment');
  assert.match(page, /new-album-tile[^`]*album-poster-card[^`]*h-full[^`]*self-stretch/, 'the create entry should fill the full poster card height');
  assert.doesNotMatch(page, /new-album-tile[^`]*aspect-\[3\/4\]/, 'the create entry must not keep the cover-only aspect ratio');
  assert.match(page, /YujeeState/, 'my-albums should use the shared state illustration component');
  assert.match(page, /variant="loading"/, 'running albums should use the loading jellyfish state');
  assert.match(page, /variant="empty"/, 'empty albums should use the empty-state illustration');
  assert.match(page, /variant="error"/, 'album-list failures should use the shared error-state illustration');
  assert.doesNotMatch(page, /cover-skeleton/, 'running albums must not use the old skeleton cover state');
  assert.doesNotMatch(page, /sk-block/, 'running albums must not keep old skeleton blocks');
  assert.match(page, /cover-fail/, 'failed albums should use the dark retry cover state');
});

test('my-albums default cover fallback uses one quiet green skin', () => {
  assert.match(page, /const DEFAULT_COVER_TINT = 'linear-gradient\(135deg,#e7eee9,#d7dedf\)'/, 'fallback cover should keep only the green tint');
  assert.doesNotMatch(page, /COVER_TINTS/, 'fallback covers should not rotate through multiple decorative tints');
  assert.doesNotMatch(page, /i % COVER_TINTS\.length/, 'fallback cover color should not depend on card index');
  assert.match(page, /style=\{\{ background: DEFAULT_COVER_TINT \}\}/, 'coverDecor should apply the single fallback tint');
});

test('my-albums wires the real generating status from API data into the card UI', () => {
  const runningBranch = getRunningBranch();

  assert.match(page, /status: 'AGENT_RUNNING' \| 'EDITING' \| 'COMPLETED' \| 'FAILED'/, 'Album type should keep the backend running status');
  assert.match(page, /const anyRunning = \(albums \?\? \[\]\)\.some\(\(a\) => a\.status === 'AGENT_RUNNING'\)/, 'polling should still be driven by real running albums');
  assert.match(page, /const runningCount = \(albums \?\? \[\]\)\.filter\(\(a\) => a\.status === 'AGENT_RUNNING'\)\.length/, 'summary should count real running albums');
  assert.match(page, /if \(status === 'AGENT_RUNNING'\) return \{ chip: 'bg-black\/\[0\.05\] text-\[#555\]', dot: '#8C5EF4' \}/, 'running chip should keep the supplied gray pill with purple dot');
  assert.match(page, /isRunning \? 'animate-\[cover-sweep_1\.2s_linear_infinite\]' : ''/, 'running chip dot should keep the supplied animated state');
  assert.match(runningBranch, /className=\{`\$\{POSTER_CARD_CLASS\} cover-running`\}/, 'running branch should render a distinct generating card shell');
  assert.match(runningBranch, /variant="loading"/, 'running branch should use the supplied loading jellyfish');
  assert.match(runningBranch, /showDots/, 'running branch should show animated theme-color dots');
  assert.doesNotMatch(runningBranch, /cover-skeleton/, 'running branch must not use the old skeleton cover state');
  assert.doesNotMatch(runningBranch, /doing-glow|sk-block|animate-\[cover-sweep_1\.5s_ease-in-out_infinite\]/, 'running branch must not keep old skeleton shimmer pieces');
  assert.match(runningBranch, /正在排版 · 约 1 分钟/, 'running branch should keep the design generating copy');
  assert.match(runningBranch, /Laying out · about 1 min/, 'running branch should keep the English generating copy');
  assert.match(runningBranch, /\{statusChip\(a\.status\)\}/, 'running branch should show the backend status chip');
  assert.doesNotMatch(runningBranch, /<AlbumCoverPreview/, 'running branch should not render the normal cover preview');
  assert.doesNotMatch(runningBranch, /\{a\.title\}/, 'running branch should not render a normal album title overlay');
});

test('my-albums shared loading states keep copy minimal', () => {
  assert.doesNotMatch(page, /Creating album|正在创建相册/, 'full-screen create loading should not show detailed creation copy');
  assert.doesNotMatch(page, /Loading the canvas|正在加载画板内容|Loading albums|正在加载相册|Loading canvas|正在加载画板/, 'shared loading states should not show detailed resource copy');
  assert.match(page, /title="Loading"/, 'shared loading states should render the single Loading label');
});

test('my-albums keeps album generation failures separate from global page errors', () => {
  const failedBranch = getFailedBranch();

  assert.match(page, /albums !== null && err && albums\.length === 0[\s\S]*variant="error"/, 'empty album-list failures should use the global error illustration');
  assert.match(failedBranch, /cover-fail/, 'album generation failures should keep the dark retry cover state');
  assert.match(failedBranch, /<RetryFailedButton albumId=\{a\.id\} variant="card" \/>/, 'failed album cards should keep retry wired to the failed album');
  assert.doesNotMatch(failedBranch, /YujeeState/, 'album generation failures must not use the global error-state component');
  assert.doesNotMatch(failedBranch, /variant="error"/, 'album generation failures must not use the global page error illustration');
});

test('my-albums keeps list and live cover previews on the normalized photo filter', () => {
  assert.match(page, /import\s*\{\s*normalizePhotoFilterState,\s*type PhotoFilterState\s*\}\s*from '@\/lib\/photo\/filter-state'/, 'list client should normalize the API filter state before using it');
  assert.match(page, /photoFilter:\s*PhotoFilterState \| null/, 'album list entries should carry the photo filter type');
  assert.match(page, /photoFilter:\s*normalizePhotoFilterState\(item\.photoFilter\)/, 'list client should retain normalized filter state');
  assert.match(page, /<AlbumCoverPreview[\s\S]*photoFilter=\{a\.photoFilter\}/, 'cover previews should receive each album filter state');

  assert.match(coverPreview, /photoFilter:\s*PhotoFilterState \| null/, 'cover preview props should accept filter state');
  assert.match(coverPreview, /photoStore\.getTierUrls\(photoKey \? photoKey\.split\(','\) : \[\], 'display', photoFilter\)/, 'cover preview display URLs should be filtered');
  assert.match(coverPreview, /\}, \[photoKey, photoFilter\]\);/, 'a filter change should cancel and replace an in-flight preview URL request');
});

test('my-albums derives uploaded cover thumbnails from exact current display pixels', () => {
  assert.match(page, /const \{ blob: displayBlob, filteredFallback \} = await photoStore\.getTierBlobStatus\(\s*photoId,\s*'display',\s*photoFilter,\s*\)/, 'thumbnail generation should request the filtered display blob with status');
  assert.match(page, /if \(!displayBlob\) continue;/, 'missing local display pixels should keep trying compatible fallback candidates');
  assert.match(page, /if \(filteredFallback\) \{[\s\S]*continue;/, 'positive-filter fallback bytes must never be uploaded as a current filtered cover');
  assert.match(page, /createCoverThumbnailJpeg\(displayBlob\)/, 'thumbnail JPEG should be encoded from display pixels, never the original');
  assert.match(page, /const coverStateKey = coverThumbnailStateKey\(album, candidatePhotoIds\);/, 'each thumbnail attempt should capture the normalized cover state');
  assert.match(page, /isCurrentCoverThumbnailState\(album\.id, coverStateKey\)/, 'stale filter or cover-detail work should be guarded before upload');
  assert.match(page, /console\.error\('Cover thumbnail upload failed', e\)/, 'existing upload diagnostic should remain available for retry investigation');
});

test('my-albums preserves the server-issued cover revision through upload confirmation', () => {
  assert.match(page, /const \{ putUrl, r2Key, coverRevision \} = signJson\.data/, 'signing should retain the opaque revision');
  assert.match(page, /body: JSON\.stringify\(\{ r2Key, coverRevision \}\)/, 'confirmation should return the exact signed revision');
});
