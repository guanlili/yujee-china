// Cross-language contract parity runner (WP0.3 / #178).
//
// Parses every case in fixtures/v3/parity.json with the TS zod contract and
// emits per-case verdicts as JSON on stdout, so the Python pydantic mirror
// (apps/agent/tests/test_schemas.py::test_cross_language_parity) can diff the
// two parsers against the shared `expectValid`. If TS and Python disagree the
// contract has drifted — the historical risk this guard exists to catch and
// the reason architecture §6.8 第 5 条 mandates "TS 先行,Python 镜像".
//
// Usage: tsx packages/contracts/scripts/parity-check.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { ZodTypeAny } from 'zod';

import { V3Chapter, V3ChapterPhoto, V3LayoutTree } from '../src/layout';
import { TemplateDef, TemplateTextSlot } from '../src/templates';
import {
  V3InternalAgentAckRequest,
  V3InternalAgentAckResponse,
  V3AcceptedResponse,
  V3AnalyzeRequest,
  V3ApplyThemeResponse,
  V3ApplyThemeRequest,
  V3Callback,
  V3ChapterChatRequest,
  V3ChapterChatResponse,
  V3CoverResponse,
  V3CoverRequest,
  V3FinalizeRequest,
  V3FinalizeResponse,
  V3RecommendRequest,
  V3RecommendResponse,
  V3TemplateCandidate,
} from '../src/v3';

const SCHEMAS: Record<string, ZodTypeAny> = {
  V3AcceptedResponse,
  AgentAckRequest: V3InternalAgentAckRequest,
  AgentAckResponse: V3InternalAgentAckResponse,
  V3AnalyzeRequest,
  V3ApplyThemeResponse,
  V3ApplyThemeRequest,
  V3Callback,
  V3Chapter,
  V3ChapterChatRequest,
  V3ChapterChatResponse,
  V3ChapterPhoto,
  V3CoverResponse,
  V3CoverRequest,
  V3FinalizeRequest,
  V3FinalizeResponse,
  V3LayoutTree,
  V3RecommendRequest,
  V3RecommendResponse,
  V3TemplateCandidate,
  TemplateDef,
  TemplateTextSlot,
};

interface ParityCase {
  name: string;
  schema: string;
  expectValid: boolean;
  payload: unknown;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', 'fixtures', 'v3', 'parity.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { cases: ParityCase[] };

const results = fixture.cases.map((c) => {
  const schema = SCHEMAS[c.schema];
  if (!schema) {
    return { name: c.name, schema: c.schema, valid: null, error: 'unknown schema' };
  }
  return { name: c.name, schema: c.schema, valid: schema.safeParse(c.payload).success };
});

process.stdout.write(JSON.stringify(results));
