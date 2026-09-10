import { BookChapter } from './storage';

// In a real e-reader, pagination is dynamic based on container size and font size.
// For this simple implementation, we chunk paragraphs into pages roughly.

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

    for (const p of chapter.paragraphs) {
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
