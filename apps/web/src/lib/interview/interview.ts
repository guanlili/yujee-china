// 内容采集(采访)环节的纯逻辑:根据一章「时间/地点是否已知」决定问哪套引导语,
// 并把用户答案 + 已知的时间/地点拼成 chapterContext(给排版和写文案当章节背景)。
//
// 时序(见 client.ts ChapterPrefill 注释):地名/时间在**提交时**按 clusterId 预算好缓存;
// 采访(analyze 回来后弹)拿章里任一 photoId 反查 clusterId,取到该章的 prefill。
// 本模块只做纯计算,不碰网络/坐标 —— place 已经是地名字符串(坐标早在浏览器丢弃)。

/** 一章的采访预填输入:该章已知的时间范围 + 代表地名(都可能缺)。 */
export type ChapterInterviewInput = {
  earliestTakenAt: string | null;
  latestTakenAt: string | null;
  place: string | null;
};

/** 一章的采访条目:章标识 + 预填输入 + 该情况的三条引导短消息。UI 逐章走。 */
export type ChapterInterview = {
  chapterId: string;
  label: string;
  input: ChapterInterviewInput;
  messages: readonly [string, string, string];
};

/** 提交时按 clusterId 预算的预填(镜像 client.ts ChapterPrefill,避免跨层耦合)。 */
export type ClusterPrefill = {
  clusterId: string;
  earliestTakenAt: string | null;
  latestTakenAt: string | null;
  place: string | null;
};

const EMPTY_INPUT: ChapterInterviewInput = {
  earliestTakenAt: null,
  latestTakenAt: null,
  place: null,
};

/**
 * 组装每章的采访条目。把「章→photoIds」(analyze 返回的章)与「clusterId→预填」(提交时算的)
 * 通过「photoId→clusterId」(浏览器确定性重算)对起来:一章的照片同属一个 cluster(§2.1a,
 * clusterId 不跨章),取该章任一 photoId 的 clusterId → 拿其预填。
 *
 * 缺预填(无 GPS/无时间,或映射对不上)的章 => 空输入(四情况归 neither,全问)。纯函数、可测。
 */
export function buildChapterInterviews(
  chapters: readonly { chapterId: string; label: string; photoIds: readonly string[] }[],
  photoToCluster: ReadonlyMap<string, string>,
  prefills: readonly ClusterPrefill[],
): ChapterInterview[] {
  const prefillByCluster = new Map(prefills.map((p) => [p.clusterId, p]));
  return chapters.map((ch) => {
    let input = EMPTY_INPUT;
    for (const photoId of ch.photoIds) {
      const clusterId = photoToCluster.get(photoId);
      const prefill = clusterId ? prefillByCluster.get(clusterId) : undefined;
      if (prefill) {
        input = {
          earliestTakenAt: prefill.earliestTakenAt,
          latestTakenAt: prefill.latestTakenAt,
          place: prefill.place,
        };
        break;
      }
    }
    return {
      chapterId: ch.chapterId,
      label: ch.label,
      input,
      messages: interviewMessages(classifyInterviewCase(input)),
    };
  });
}

/** 四情况:按「时间已知?地点已知?」分。决定问哪套引导语、拼哪些前缀。 */
export type InterviewCase =
  | 'timeAndPlace' // 时间✓ 地点✓ —— 只问人/事/心情
  | 'timeOnly' // 时间✓ 地点✗ —— 问地点+人事
  | 'placeOnly' // 时间✗ 地点✓ —— 问时间+人事
  | 'neither'; // 时间✗ 地点✗ —— 全问

export function classifyInterviewCase(input: ChapterInterviewInput): InterviewCase {
  const hasTime = Boolean(input.earliestTakenAt);
  const hasPlace = Boolean(input.place && input.place.trim());
  if (hasTime && hasPlace) return 'timeAndPlace';
  if (hasTime) return 'timeOnly';
  if (hasPlace) return 'placeOnly';
  return 'neither';
}

// 每情况一套引导语,拆成三条短消息连着发(模仿真人一句一句打字)。一章只问这一次,不追问。
// 已知的信息不再问(时间已知就不问时间,地点已知就不问地点)。
const PROMPTS: Record<'zh' | 'en', Record<InterviewCase, readonly [string, string, string]>> = {
  zh: {
    timeAndPlace: [
      '这组照片我大概整理好啦～',
      '不过想再多了解一点：当时是和谁一起的呀？',
      '有没有什么特别的人、事，或者心情，想记进这本相册里？',
    ],
    timeOnly: [
      '这组照片挺有感觉的～',
      '是在哪儿拍的呀？当时和谁在一起？',
      '有什么想留下的回忆或心情，都可以跟我说说。',
    ],
    placeOnly: [
      '这组照片我看过啦～',
      '大概是什么时候拍的呀？和谁一起的？',
      '有没有特别想记录的故事或心情？',
    ],
    neither: [
      '想更懂这组照片一点～',
      '大概是什么时候、在哪、和谁一起拍的呀？',
      '当时发生了什么、心情怎样，随便聊聊都行。',
    ],
  },
  en: {
    timeAndPlace: [
      "I've grouped these photos for you.",
      'I’d love to know a little more — who were you with that day?',
      'Any special people, moments, or feelings you’d like woven into this book?',
    ],
    timeOnly: [
      'These photos have a lovely feel to them.',
      'Where were they taken, and who were you with?',
      'Tell me any memory or mood you’d like to keep.',
    ],
    placeOnly: [
      "I've looked through these photos.",
      'Roughly when were they taken, and who were you with?',
      'Any story or feeling you especially want to record?',
    ],
    neither: [
      'I’d love to understand these photos a little more.',
      'Roughly when, where, and with whom were they taken?',
      'What happened, how did it feel — tell me anything you like.',
    ],
  },
};

/** 取某情况的三条引导短消息。默认中文(兼容旧调用);传 locale 拿英文那套。 */
export function interviewMessages(
  caseKind: InterviewCase,
  locale: 'zh' | 'en' = 'zh',
): readonly [string, string, string] {
  return PROMPTS[locale][caseKind];
}

/**
 * 把 ISO(或 EXIF-local)datetime 归一成 "YYYY/MM/DD" 显示串。解析失败 => null。
 * 只取日期(采访前缀不需要时分秒)。
 */
export function formatDatePrefix(takenAt: string | null): string | null {
  if (!takenAt) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt);
  if (!m) return null;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

/**
 * 组装 chapterContext:已知的时间/地点拼成结构化前缀,用户原话原样跟在后面。
 * 例:
 *   时间：2026/12/15  地点：杭州
 *   （用户原话）那天是奶奶生日，全家第一次到齐……
 *
 * 只拼「已知」的字段(缺的不写);用户答案为空时只留前缀;两者都空 => 空串(等于跳过)。
 * 结果裁到 500(与 V3Chapter.chapterContext 上限对齐)。PRIVACY:place 是地名字符串,无坐标。
 */
export function buildChapterContext(
  input: ChapterInterviewInput,
  userAnswer: string,
): string {
  const facts: string[] = [];
  const date = formatDatePrefix(input.earliestTakenAt);
  if (date) {
    // 时间范围跨天时补个「~ 结束日」,让用户知道系统识别到的是一段。
    const end = formatDatePrefix(input.latestTakenAt);
    facts.push(end && end !== date ? `时间：${date}~${end}` : `时间：${date}`);
  }
  if (input.place && input.place.trim()) {
    facts.push(`地点：${input.place.trim()}`);
  }

  const prefix = facts.length > 0 ? facts.join('  ') : '';
  const answer = userAnswer.trim();

  let out: string;
  if (prefix && answer) out = `${prefix}\n（用户原话）${answer}`;
  else if (prefix) out = prefix;
  else out = answer;

  return out.slice(0, 500);
}
