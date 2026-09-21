import { BookChapter } from './storage';

function splitLongParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Fast fallback used only before the measured paginator has run. */
export function paginateBook(
  chapters: BookChapter[],
  paragraphsPerPage = Number.POSITIVE_INFINITY,
  maxCharsPerPage = 5200,
) {
  let totalPages = 0;
  const paginatedChapters = chapters.map(chapter => {
    const pages: string[][] = [];
    let currentPage: string[] = [];
    let currentParagraphCount = 0;
    let currentChars = 0;

    for (const originalParagraph of chapter.paragraphs) {
      const paragraphParts = splitLongParagraph(originalParagraph, maxCharsPerPage);
      for (const p of paragraphParts) {
        const reachesParagraphLimit = currentParagraphCount >= paragraphsPerPage;
        const reachesCharacterLimit = currentChars + p.length > maxCharsPerPage;
        if ((reachesParagraphLimit || reachesCharacterLimit) && currentPage.length > 0) {
          pages.push([...currentPage]);
          currentPage = [];
          currentChars = 0;
          currentParagraphCount = 0;
        }
        currentPage.push(p);
        currentChars += p.length;
        currentParagraphCount++;
      }
    }

    if (currentPage.length > 0) pages.push(currentPage);
    if (pages.length === 0) pages.push([]);
    totalPages += pages.length;
    return { title: chapter.title, pages, images: chapter.images, standaloneImagePage: chapter.standaloneImagePage };
  });

  return { paginatedChapters, totalPages };
}

export type ContinuousPageBlock =
  | { kind: 'heading'; title: string; images?: string[] }
  | { kind: 'paragraph'; text: string };

export interface ContinuousMeasuredPage {
  title: string;
  blocks: ContinuousPageBlock[];
}

export interface MeasuredPaginationOptions {
  contentWidth: number;
  contentHeight: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: number;
  paragraphSpacingEm: number;
  firstLineIndent: boolean;
  textAlign: 'left' | 'justify';
  showIllustrations?: boolean;
  illustrationReservePx?: number;
}

/**
 * True browser-height pagination with real chapter boundaries.
 *
 * Every BookChapter starts on a fresh reader page, while the text inside that
 * chapter is packed by the actual rendered DOM height.
 *
 * EPUB image-only spine items are preserved as their own reader pages.
 */
export function paginateBookContinuousMeasured(
  chapters: BookChapter[],
  options: MeasuredPaginationOptions,
): { pages: ContinuousMeasuredPage[]; totalPages: number } {
  if (typeof document === 'undefined') {
    const fallback = paginateBook(chapters);
    const pages: ContinuousMeasuredPage[] = [];
    fallback.paginatedChapters.forEach(chapter => {
      chapter.pages.forEach((paragraphs, pageIndex) => {
        pages.push({
          title: chapter.title,
          blocks: [
            ...(pageIndex === 0 ? [{ kind: 'heading' as const, title: chapter.title, images: chapter.images }] : []),
            ...paragraphs.map(text => ({ kind: 'paragraph' as const, text })),
          ],
        });
      });
    });
    return { pages, totalPages: pages.length };
  }

  const {
    contentWidth,
    contentHeight,
    fontSize,
    lineHeight,
    fontFamily,
    fontWeight,
    paragraphSpacingEm,
    firstLineIndent,
    textAlign,
    showIllustrations = true,
    illustrationReservePx = 0,
  } = options;

  const measurer = document.createElement('div');
  Object.assign(measurer.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: `${Math.max(240, contentWidth)}px`,
    fontSize: `${fontSize}px`,
    lineHeight: String(lineHeight),
    fontFamily,
    fontWeight: String(fontWeight),
    boxSizing: 'border-box',
    overflow: 'visible',
    whiteSpace: 'normal',
  } as CSSStyleDeclaration);
  document.body.appendChild(measurer);

  const createBlockElement = (block: ContinuousPageBlock, index: number): HTMLElement[] => {
    if (block.kind === 'heading') {
      const elements: HTMLElement[] = [];

      if (showIllustrations && block.images?.length && illustrationReservePx > 0) {
        const imageReserve = document.createElement('div');
        imageReserve.style.height = `${illustrationReservePx}px`;
        imageReserve.style.marginBottom = '20px';
        elements.push(imageReserve);
      }

      if (block.title) {
        const h = document.createElement('h2');
        h.textContent = block.title;
        Object.assign(h.style, {
          margin: index === 0 ? '0 0 24px 0' : '24px 0 24px 0',
          padding: '0',
          textAlign: 'center',
          fontSize: `${fontSize * 1.1}px`,
          lineHeight: '1.35',
          fontWeight: '700',
        });
        elements.push(h);
      }

      return elements;
    }

    const p = document.createElement('p');
    p.textContent = block.text;
    Object.assign(p.style, {
      margin: index > 0 ? `${paragraphSpacingEm}em 0 0 0` : '0',
      padding: '0',
      textIndent: firstLineIndent ? '1.5em' : '0',
      font: 'inherit',
      lineHeight: 'inherit',
      textAlign,
      overflowWrap: 'break-word',
    });
    return [p];
  };

  const heightFits = () => measurer.getBoundingClientRect().height <= contentHeight + 0.5;

  const appendPermanentBlock = (block: ContinuousPageBlock, index: number) => {
    for (const el of createBlockElement(block, index)) measurer.appendChild(el);
  };

  const fitsCandidate = (block: ContinuousPageBlock, index: number) => {
    const elements = createBlockElement(block, index);
    for (const el of elements) measurer.appendChild(el);
    const fits = heightFits();
    for (const el of elements) el.remove();
    return fits;
  };

  const splitParagraphToFit = (
    text: string,
    currentBlockCount: number,
    forceProgress: boolean,
  ): [string, string] => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [text, ''];

    const temp = createBlockElement(
      { kind: 'paragraph', text: '' },
      currentBlockCount,
    )[0] as HTMLParagraphElement;
    measurer.appendChild(temp);

    let low = 1;
    let high = words.length;
    let best = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      temp.textContent = words.slice(0, mid).join(' ');

      if (heightFits()) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    temp.remove();

    const count = best > 0 ? best : (forceProgress ? 1 : 0);
    return [words.slice(0, count).join(' '), words.slice(count).join(' ')];
  };

  const pages: ContinuousMeasuredPage[] = [];
  let current: ContinuousPageBlock[] = [];
  let activeTitle = chapters[0]?.title || '';
  let currentPageTitle = activeTitle;

  const clearMeasuredPage = () => {
    measurer.replaceChildren();
  };

  const pushBlock = (block: ContinuousPageBlock) => {
    appendPermanentBlock(block, current.length);
    current.push(block);
  };

  const flush = () => {
    if (!current.length) return;
    pages.push({ title: currentPageTitle || activeTitle, blocks: current });
    current = [];
    currentPageTitle = activeTitle;
    clearMeasuredPage();
  };

  const addParagraph = (originalText: string) => {
    let remaining = originalText.trim();

    while (remaining) {
      const fullBlock: ContinuousPageBlock = { kind: 'paragraph', text: remaining };

      if (fitsCandidate(fullBlock, current.length)) {
        pushBlock(fullBlock);
        return;
      }

      const [head, tail] = splitParagraphToFit(
        remaining,
        current.length,
        current.length === 0,
      );

      if (head) {
        pushBlock({ kind: 'paragraph', text: head });
      }

      if (current.length) flush();

      remaining = tail || (head ? '' : remaining);
      if (!head && remaining) continue;
    }
  };

  try {
    chapters.forEach((chapter, chapterIndex) => {
      // Image-only XHTML in the EPUB spine is a real standalone page.
      // Do not merge it into the previous/next prose chapter and do not invent
      // a "Chapter N" title for it.
      if (chapter.standaloneImagePage && chapter.images?.length) {
        flush();
        activeTitle = chapter.title || '';
        currentPageTitle = activeTitle;
        pushBlock({
          kind: 'heading',
          title: chapter.title || '',
          images: chapter.images,
        });
        flush();
        return;
      }

      const title = chapter.title || `Chapter ${chapterIndex + 1}`;

      // Every real chapter starts on a fresh reader page.
      flush();

      activeTitle = title;
      currentPageTitle = title;
      pushBlock({ kind: 'heading', title, images: chapter.images });

      for (const paragraph of chapter.paragraphs) {
        if (!paragraph?.trim()) continue;
        addParagraph(paragraph);
      }

      flush();
    });
  } finally {
    measurer.remove();
  }

  return { pages, totalPages: pages.length };
}
