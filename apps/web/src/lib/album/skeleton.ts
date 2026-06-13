import { TEMPLATES, TEMPLATE_IDS, type TemplateDef } from '@yujee/contracts/templates';

export type SkeletonUseCase = 'chapter' | 'cover' | 'toc' | 'closing';
type PhotoQuality = 'hero' | 'detail' | 'fill';

export type SkeletonPhoto = {
  photoId: string;
  analysis: {
    photoId?: string;
    quality: PhotoQuality;
    orientation?: 'portrait' | 'landscape' | 'square';
    [key: string]: unknown;
  };
  exif?: { order?: number; [key: string]: unknown };
  used?: boolean;
  [key: string]: unknown;
};

export type SkeletonPage = {
  pageIndex: number;
  templateId: string;
  images: Record<string, string>;
  texts: Record<string, string>;
};

type SkeletonChapterInput = {
  chapterId: string;
  cluster?: { label?: string; [key: string]: unknown };
  photoIds: string[];
  [key: string]: unknown;
};

type SkeletonInput = {
  albumId?: string;
  photos: SkeletonPhoto[];
  chapters: SkeletonChapterInput[];
};

type SkeletonChapterOutput = SkeletonChapterInput & { pages: SkeletonPage[] };

export type SkeletonResult = {
  basePages: { cover: SkeletonPage; toc?: SkeletonPage | null; ending: SkeletonPage };
  chapters: SkeletonChapterOutput[];
  pages: SkeletonPage[];
};

type PickTemplateArgs = {
  useCase: SkeletonUseCase;
  imageCount: number;
  photos: SkeletonPhoto[];
  exclude?: Iterable<string>;
  albumId?: string;
  chapterId?: string;
  pageOrdinal?: number;
  attempt?: number;
};

const QUALITY_RANK: Record<PhotoQuality, number> = {
  hero: 0,
  detail: 1,
  fill: 2,
};

function compareStrings(a: string, b: string): number {
  const aPoints = Array.from(a);
  const bPoints = Array.from(b);
  const length = Math.min(aPoints.length, bPoints.length);
  for (let i = 0; i < length; i += 1) {
    const diff = aPoints[i].codePointAt(0)! - bPoints[i].codePointAt(0)!;
    if (diff !== 0) return diff;
  }
  return aPoints.length - bPoints.length;
}

function compareStringArrays(a: string[], b: string[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = compareStrings(a[i], b[i]);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

function quality(photo: SkeletonPhoto): PhotoQuality {
  return photo.analysis.quality;
}

function orientation(photo: SkeletonPhoto): string | undefined {
  return photo.analysis.orientation;
}

function photoOrder(photo: SkeletonPhoto): number {
  const value = photo.exif?.order;
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

function isUsed(photo: SkeletonPhoto): boolean {
  return photo.used ?? true;
}

function isHeroSlot(slot: TemplateDef['images'][number]): boolean {
  const qualities: readonly string[] = slot.quality ?? [];
  return qualities.includes('hero') && !qualities.includes('fill');
}

function useCaseForTemplate(templateId: string, template: TemplateDef): SkeletonUseCase {
  if (templateId === 'mag-02') return 'toc';
  if (template.slot === 'cover') return 'cover';
  if (template.slot === 'ending') return 'closing';
  return 'chapter';
}

function buildTemplatesBy(): Record<SkeletonUseCase, Record<number, string[]>> {
  const out: Record<SkeletonUseCase, Record<number, string[]>> = {
    chapter: {},
    cover: {},
    toc: {},
    closing: {},
  };

  for (const templateId of [...TEMPLATE_IDS].sort()) {
    const template = TEMPLATES[templateId];
    const useCase = useCaseForTemplate(templateId, template);
    const imageCount = template.images.length;
    out[useCase][imageCount] ??= [];
    out[useCase][imageCount].push(templateId);
  }

  return out;
}

export const TEMPLATES_BY = buildTemplatesBy();

export function fillCapacity(useCase: SkeletonUseCase, imageCount: number): number {
  const candidates = TEMPLATES_BY[useCase][imageCount] ?? [];
  let max = 0;
  for (const templateId of candidates) {
    const template = TEMPLATES[templateId];
    const capacity = template.images.filter((slot) => !isHeroSlot(slot)).length;
    max = Math.max(max, capacity);
  }
  return max;
}

export function partitionChapterPhotos(chapterPhotos: SkeletonPhoto[]): SkeletonPhoto[][] {
  const heroes = chapterPhotos.filter((photo) => quality(photo) === 'hero');
  const solo = heroes[0];
  const rest = solo ? chapterPhotos.filter((photo) => photo !== solo) : [...chapterPhotos];
  const pages: SkeletonPhoto[][] = [];

  if (solo) pages.push([solo]);

  if (rest.length === 1) {
    pages.push(rest.slice(0, 1));
  } else if (rest.length === 2) {
    pages.push(rest.slice(0, 2));
  } else if (rest.length > 2) {
    const q = Math.floor(rest.length / 3);
    const r = rest.length % 3;
    const pageSizes =
      r === 0
        ? Array.from({ length: q }, () => 3)
        : r === 1
          ? [...Array.from({ length: q - 1 }, () => 3), 2, 2]
          : [...Array.from({ length: q }, () => 3), 2];

    let offset = 0;
    for (const size of pageSizes) {
      pages.push(rest.slice(offset, offset + size));
      offset += size;
    }
  }

  return pages.flatMap((page) => {
    const fillCount = page.filter((photo) => quality(photo) === 'fill').length;
    if (page.length === 3 && fillCount === 3) {
      return [page.slice(0, 2), page.slice(2)];
    }
    return [page];
  });
}

export function canPlace(templateId: string, photos: SkeletonPhoto[]): boolean {
  const template = TEMPLATES[templateId];
  if (!template) return false;
  if (template.images.length !== photos.length) return false;

  const fillCount = photos.filter((photo) => quality(photo) === 'fill').length;
  const fillOk = template.images.filter((slot) => !isHeroSlot(slot)).length;
  return fillCount <= fillOk;
}

export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function pickTemplate({
  useCase,
  imageCount,
  photos,
  exclude = [],
  albumId = '',
  chapterId = '',
  pageOrdinal = 0,
  attempt = 0,
}: PickTemplateArgs): string {
  const candidates = [...(TEMPLATES_BY[useCase][imageCount] ?? [])];
  if (candidates.length === 0) {
    throw new Error(`no templates for useCase=${useCase} imageCount=${imageCount}`);
  }

  const legal = candidates.filter((templateId) => canPlace(templateId, photos));
  if (legal.length === 0) {
    const fillCount = photos.filter((photo) => quality(photo) === 'fill').length;
    throw new Error(
      `no legal templates for useCase=${useCase} imageCount=${imageCount} fillCount=${fillCount}`,
    );
  }

  const excluded = new Set(exclude);
  const pool = legal.filter((templateId) => !excluded.has(templateId));
  const finalPool = pool.length > 0 ? pool : legal;
  const seed = stableHash(`${albumId}:${chapterId}:${pageOrdinal}:${attempt}`);
  return finalPool[seed % finalPool.length];
}

function imageScore(slot: TemplateDef['images'][number], photo: SkeletonPhoto): number {
  let score = 0;
  if (slot.quality?.includes(quality(photo))) score += 10;
  if (slot.orientation?.includes(orientation(photo) as never)) score += 2;
  return score;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const current = items[i];
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) {
      out.push([current, ...tail]);
    }
  }
  return out;
}

export function assignImages(
  templateId: string,
  photos: SkeletonPhoto[],
  options: { allowFillInHero?: boolean } = {},
): Record<string, string> {
  const template = TEMPLATES[templateId];
  const slotEntries = template.images;
  if (slotEntries.length !== photos.length) {
    throw new Error(`template ${templateId} expects ${slotEntries.length} images, got ${photos.length}`);
  }
  if (slotEntries.length === 0) return {};

  let bestScore: number | undefined;
  let bestIds: string[] | undefined;
  let bestMapping: Record<string, string> | undefined;

  for (const orderedPhotos of permutations(photos)) {
    let score = 0;
    const mapping: Record<string, string> = {};
    let valid = true;

    for (let i = 0; i < slotEntries.length; i += 1) {
      const slot = slotEntries[i];
      const slotName = slot.id;
      const photo = orderedPhotos[i];
      if (quality(photo) === 'fill' && isHeroSlot(slot) && !options.allowFillInHero) {
        valid = false;
        break;
      }
      score += imageScore(slot, photo);
      mapping[slotName] = photo.photoId;
    }

    if (!valid) continue;

    const ids = slotEntries.map((slot) => mapping[slot.id]);
    const tieBreaksEarlier = bestIds === undefined || compareStringArrays(ids, bestIds) < 0;
    if (bestScore === undefined || score > bestScore || (score === bestScore && tieBreaksEarlier)) {
      bestScore = score;
      bestIds = ids;
      bestMapping = mapping;
    }
  }

  if (!bestMapping) throw new Error(`could not assign images for template ${templateId}`);
  return bestMapping;
}

export function buildChapterPages(
  albumId: string,
  chapterId: string,
  photos: SkeletonPhoto[],
  attempt = 0,
): SkeletonPage[] {
  const pages: SkeletonPage[] = [];
  let previousTemplateId: string | undefined;

  partitionChapterPhotos(photos).forEach((pagePhotos, ordinal) => {
    const templateId = pickTemplate({
      useCase: 'chapter',
      imageCount: pagePhotos.length,
      photos: pagePhotos,
      exclude: previousTemplateId ? [previousTemplateId] : [],
      albumId,
      chapterId,
      pageOrdinal: ordinal,
      attempt,
    });

    pages.push({
      pageIndex: 0,
      templateId,
      images: assignImages(templateId, pagePhotos),
      texts: {},
    });
    previousTemplateId = templateId;
  });

  return pages;
}

export function needsToc(chapters: unknown[], totalPages: number): boolean {
  return chapters.length >= 4 && totalPages >= 8;
}

function bestPhoto(photos: SkeletonPhoto[]): SkeletonPhoto | undefined {
  return [...photos].sort((a, b) => {
    const qualityDiff = QUALITY_RANK[quality(a)] - QUALITY_RANK[quality(b)];
    if (qualityDiff !== 0) return qualityDiff;
    const orderDiff = photoOrder(a) - photoOrder(b);
    if (orderDiff !== 0) return orderDiff;
    return compareStrings(a.photoId, b.photoId);
  })[0];
}

function buildToc(chapters: SkeletonChapterOutput[]): SkeletonPage {
  const texts: Record<string, string> = {};
  chapters.forEach((chapter, idx) => {
    texts[`items[${idx}].title`] = String(chapter.cluster?.label ?? chapter.chapterId ?? `Chapter ${idx + 1}`);
  });
  return { pageIndex: 0, templateId: 'mag-02', images: {}, texts };
}

function buildBasePages(
  albumId: string,
  usedPhotos: SkeletonPhoto[],
  chapterPages: SkeletonPage[],
): { cover: SkeletonPage; ending: SkeletonPage } {
  const useCount = new Map<string, number>();
  for (const page of chapterPages) {
    for (const photoId of Object.values(page.images)) {
      useCount.set(photoId, (useCount.get(photoId) ?? 0) + 1);
    }
  }
  const budgetOk = (photo: SkeletonPhoto) => (useCount.get(photo.photoId) ?? 0) < 2;

  const endingPick =
    bestPhoto(usedPhotos.filter((photo) => quality(photo) !== 'fill' && budgetOk(photo))) ??
    bestPhoto(usedPhotos.filter(budgetOk)) ??
    bestPhoto(usedPhotos);
  if (!endingPick) throw new Error('cannot build ending without at least one used photo');

  const ending: SkeletonPage = {
    pageIndex: 0,
    templateId: 'mag-17',
    images: assignImages('mag-17', [endingPick], { allowFillInHero: true }),
    texts: {},
  };
  useCount.set(endingPick.photoId, (useCount.get(endingPick.photoId) ?? 0) + 1);

  const coverPick = bestPhoto(usedPhotos.filter((photo) => quality(photo) !== 'fill' && budgetOk(photo)));
  if (!coverPick) {
    return {
      cover: { pageIndex: 0, templateId: 'mag-20', images: {}, texts: {} },
      ending,
    };
  }

  const coverTemplateId = pickTemplate({
    useCase: 'cover',
    imageCount: 1,
    photos: [coverPick],
    albumId,
    chapterId: 'cover',
    pageOrdinal: 0,
  });

  return {
    cover: {
      pageIndex: 0,
      templateId: coverTemplateId,
      images: assignImages(coverTemplateId, [coverPick]),
      texts: {},
    },
    ending,
  };
}

export function buildSkeleton(input: SkeletonInput): SkeletonResult {
  const albumId = input.albumId ?? '';
  const photosById = new Map(input.photos.map((photo) => [photo.photoId, photo]));
  const usedPhotos = input.photos.filter(isUsed);
  const chapters: SkeletonChapterOutput[] = [];
  const bodyPages: SkeletonPage[] = [];

  for (const chapter of input.chapters) {
    const chapterPhotos = chapter.photoIds.map((photoId) => {
      const found = photosById.get(photoId);
      if (!found) throw new Error(`missing photoId in skeleton input: ${photoId}`);
      return found;
    }).filter(isUsed);

    const pages = buildChapterPages(albumId, chapter.chapterId, chapterPhotos);
    const outputChapter = { ...chapter, pages };
    chapters.push(outputChapter);
    bodyPages.push(...pages);
  }

  const { cover, ending } = buildBasePages(albumId, usedPhotos, bodyPages);
  const toc = needsToc(chapters, 1 + bodyPages.length + 1) ? buildToc(chapters) : null;
  const pages = toc ? [cover, toc, ...bodyPages, ending] : [cover, ...bodyPages, ending];

  pages.forEach((page, pageIndex) => {
    page.pageIndex = pageIndex;
  });

  return {
    basePages: { cover, toc, ending },
    chapters,
    pages,
  };
}
