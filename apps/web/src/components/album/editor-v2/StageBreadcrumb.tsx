import type { Locale } from '@/lib/i18n/routing';
import { computeStagePills, type StageKey } from './stage-breadcrumb-util';

// 五环节面包屑(WP2.4 / §2 五环节 + §4.2(1)). Highlights which of the five steps the
// album is on (albums.stage), so the editor always shows 分析 → 章节故事 → 确定主题 →
// 书籍设计 → 待导出 with the current 环节 lit. Pure presentational: it reads the
// stage string the server owns (stage 推进权在 Web, §8.3) and never mutates it.
//
// In the chapter-story (story) 环节 it also renders per-chapter done ticks so the
// user sees「一章一确定」progress (各章 done, §4.2(1)).
//
// The pure stage→pill-state logic lives in ./stage-breadcrumb-util (unit-tested).

const STAGE_LABELS: Record<Locale, Record<StageKey, string>> = {
  zh: {
    analysing: '分析',
    story: '章节故事',
    theme: '确定主题',
    cover: '书籍设计',
    ready: '待导出',
  },
  en: {
    analysing: 'Analyze',
    story: 'Story',
    theme: 'Theme',
    cover: 'Design',
    ready: 'Export',
  },
};

export function StageBreadcrumb({
  stage,
  locale,
  // story 环节进度(可选):全部章 + 已确定章,渲染每章 done 勾。
  chapterProgress,
}: {
  stage: string | undefined;
  locale: Locale;
  chapterProgress?: { chapterOrder: string[]; doneChapterIds: string[] } | null;
}) {
  const pills = computeStagePills(stage);
  const labels = STAGE_LABELS[locale];
  const doneSet = new Set(chapterProgress?.doneChapterIds ?? []);
  const showChapterTicks =
    stage === 'story' && !!chapterProgress && chapterProgress.chapterOrder.length > 0;

  return (
    <div className="state-stepper" data-testid="stage-breadcrumb">
      <div className="flex items-center">
        {pills.map((pill, i) => (
          <span key={pill.key} className="flex items-center">
            <span
              className={`state-pill${pill.state === 'active' ? ' active' : ''}${
                pill.state === 'done' ? ' done' : ''
              }`}
              data-stage={pill.key}
              data-state={pill.state}
            >
              <span className="state-dot" />
              <span>{labels[pill.key]}</span>
            </span>
            {i < pills.length - 1 && (
              <span className="state-arrow" aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3 h-3"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            )}
          </span>
        ))}
      </div>
      {showChapterTicks && (
        <div
          className="chapter-ticks flex items-center gap-1.5 mt-1.5"
          data-testid="chapter-ticks"
        >
          {chapterProgress!.chapterOrder.map((id, i) => (
            <span
              key={id}
              className={`chapter-tick${doneSet.has(id) ? ' done' : ''}`}
              data-chapter={id}
              data-done={doneSet.has(id) ? 'true' : 'false'}
              title={`${locale === 'zh' ? '第' : 'Ch.'} ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
