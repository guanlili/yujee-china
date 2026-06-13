import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS } from '@yujee/contracts/templates';
import { WEB_TEMPLATE_REGISTRY } from './web-registry';
import { PDF_TEMPLATE_REGISTRY } from './pdf-registry';

// Every template in the registry must render on BOTH surfaces. A web-only
// template (the mag-21 regression) renders fine in the editor but throws on PDF
// export — the half that the user actually pays for. This guards the invariant.
test('every template id has a web AND a pdf renderer', () => {
  for (const id of TEMPLATE_IDS) {
    assert.ok(WEB_TEMPLATE_REGISTRY[id], `${id} is missing a web renderer`);
    assert.ok(PDF_TEMPLATE_REGISTRY[id], `${id} is missing a pdf renderer`);
  }
});

test('no orphan renderer without a registered template', () => {
  const ids = new Set<string>(TEMPLATE_IDS);
  for (const id of Object.keys(WEB_TEMPLATE_REGISTRY)) {
    assert.ok(ids.has(id), `web renderer "${id}" has no template in the registry`);
  }
  for (const id of Object.keys(PDF_TEMPLATE_REGISTRY)) {
    assert.ok(ids.has(id), `pdf renderer "${id}" has no template in the registry`);
  }
});
