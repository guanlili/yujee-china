import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

test('authoring draft refresh reads the lifted current filter, never stale album detail state', () => {
  assert.match(source, /function EditorAuthoring\(\{[\s\S]*?photoFilter[\s\S]*?\}\)/);
  assert.match(source, /photoFilterRef\.current\s*=\s*photoFilter/);
  assert.match(source, /getTierUrls\([\s\S]*?photoFilterRef\.current/);
  assert.doesNotMatch(
    source.slice(source.indexOf('function EditorAuthoring'), source.indexOf('function EditorShell')),
    /getTierUrls\([\s\S]{0,160}detail\.album\.photoFilter/,
  );
});

test('every EditorBook remount asks the latest-commit reload for current shell state', () => {
  assert.match(source, /useEffect\(\(\) => \{\s*void coordinator\.current\?\.reloadPhotoFilter\(photoFilter\);[\s\S]*?\[photoFilter,\s*canvasEpoch/);
  assert.match(source, /const displayReload = createLatestCommit/);
  assert.match(source, /displayReload\.run\(\(\) => photoStore\.getTierUrls\(ids,\s*'display',\s*state\)\)/);
  assert.match(source, /displayReload\.dispose\(\)/);
});

test('responsive desktop/mobile shell switches keep one lifted filter state', () => {
  const editorBody = source.slice(
    source.indexOf('function ReadyEditor'),
    source.indexOf('function EditorLoadingState'),
  );
  const authoringBody = source.slice(
    source.indexOf('function EditorAuthoring'),
    source.indexOf('// ════════════════════════════════════════════════════════════════════════════\n// EditorShell'),
  );

  assert.match(editorBody, /const \[photoFilter, setPhotoFilter\] = useState/);
  assert.match(editorBody, /shouldMountLegacyMobileEditor\(device, detail\.pages\)/);
  assert.match(
    editorBody,
    /<MobileEditorRoot[\s\S]*?photoFilter=\{photoFilter\}[\s\S]*?setPhotoFilter=\{setPhotoFilter\}/,
  );
  assert.match(
    authoringBody,
    /shouldMountMobileEditor\(device, pages\)[\s\S]*?<MobileEditorRoot[\s\S]*?photoFilter=\{photoFilter\}[\s\S]*?setPhotoFilter=\{setPhotoFilter\}/,
  );
});

test('the real album owns filter state only after loading/building placeholders unmount', () => {
  const portBody = source.slice(
    source.indexOf('export function EditorPort'),
    source.indexOf('function ReadyEditor'),
  );
  const readyBody = source.slice(
    source.indexOf('function ReadyEditor'),
    source.indexOf('function EditorLoadingState'),
  );

  assert.doesNotMatch(portBody, /useState<PhotoFilterState/);
  assert.match(portBody, /<ReadyEditor key=\{detail\.album\.id\}/);
  assert.match(readyBody, /useState<PhotoFilterState \| null>\(\s*detail\.album\.photoFilter/);
});
