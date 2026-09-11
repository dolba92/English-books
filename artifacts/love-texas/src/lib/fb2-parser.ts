export async function parseFb2(file: File) {
  return new Promise<{ title: string; author: string; coverUrl?: string; chapters: { title: string; paragraphs: string[] }[] }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        // Metadata
        const titleInfo = xmlDoc.getElementsByTagName("title-info")[0];
        const titleNode = titleInfo?.getElementsByTagName("book-title")[0];
        const title = titleNode?.textContent || "Unknown Title";

        const authorNode = titleInfo?.getElementsByTagName("author")[0];
        const firstName = authorNode?.getElementsByTagName("first-name")[0]?.textContent || "";
        const lastName = authorNode?.getElementsByTagName("last-name")[0]?.textContent || "";
        const author = `${firstName} ${lastName}`.trim() || "Unknown Author";

        // Cover
        let coverUrl: string | undefined = undefined;
        const binaryNodes = xmlDoc.getElementsByTagName("binary");
        const coverPage = xmlDoc.getElementsByTagName("coverpage")[0];
        const coverImage = coverPage?.getElementsByTagName("*")[0];
        const coverRef = coverImage?.getAttribute("l:href") || coverImage?.getAttribute("href") || "";
        const explicitCoverId = coverRef.replace(/^#/, "");
        if (binaryNodes.length > 0) {
           for (let i = 0; i < binaryNodes.length; i++) {
             const node = binaryNodes[i];
             const id = node.getAttribute("id");
             if (id && (id === explicitCoverId || /cover/i.test(id))) {
               const contentType = node.getAttribute("content-type") || "image/jpeg";
               const base64 = node.textContent?.trim();
               if (base64) {
                 coverUrl = `data:${contentType};base64,${base64}`;
               }
               break;
             }
           }
        }

        // Chapters
        const chapters: { title: string; paragraphs: string[] }[] = [];
        const bodyNodes = xmlDoc.getElementsByTagName("body");
        
        // Usually the first body is the main content
        const mainBody = bodyNodes[0];
        if (mainBody) {
          const sections = mainBody.getElementsByTagName("section");
          
          if (sections.length > 0) {
            for (let i = 0; i < sections.length; i++) {
              const section = sections[i];
              let chapterTitle = `Chapter ${i + 1}`;
              
              const titleNode = section.getElementsByTagName("title")[0];
              if (titleNode) {
                 chapterTitle = titleNode.textContent?.trim() || chapterTitle;
              }

              const paragraphs: string[] = [];
              const pNodes = section.getElementsByTagName("p");
              for (let j = 0; j < pNodes.length; j++) {
                const pText = pNodes[j].textContent?.trim();
                if (pText) {
                  paragraphs.push(pText);
                }
              }

              if (paragraphs.length > 0) {
                 chapters.push({ title: chapterTitle, paragraphs });
              }
            }
          } else {
            // No sections, just paragraphs
            const paragraphs: string[] = [];
            const pNodes = mainBody.getElementsByTagName("p");
            for (let j = 0; j < pNodes.length; j++) {
              const pText = pNodes[j].textContent?.trim();
              if (pText) paragraphs.push(pText);
            }
            if (paragraphs.length > 0) {
              chapters.push({ title: "Content", paragraphs });
            }
          }
        }

        resolve({
          title,
          author,
          coverUrl,
          chapters: chapters.length ? chapters : [{ title: "Content", paragraphs: ["No text found"] }]
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
