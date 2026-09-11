import { BookChapter } from './storage';

function splitLongParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'»]?|$)/g)?.map(part => part.trim()).filter(Boolean) || [];
  if (sentences.length <= 1) {
    const words = text.split(/\s+/);
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

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && next.length > maxChars) {
      chunks.push(current);
      current = sentence;
    } else if (sentence.length > maxChars) {
      if (current) chunks.push(current);
      chunks.push(...splitLongParagraph(sentence, maxChars));
      current = '';
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function paginateBook(
  chapters: BookChapter[],
  paragraphsPerPage = 6,
  maxCharsPerPage = 2300,
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
    
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    
    // If a chapter is totally empty, give it one empty page
    if (pages.length === 0) {
      pages.push([]);
    }

    totalPages += pages.length;
    
    return {
      title: chapter.title,
      pages,
      images: chapter.images,
    };
  });
  
  return {
    paginatedChapters,
    totalPages
  };
}
