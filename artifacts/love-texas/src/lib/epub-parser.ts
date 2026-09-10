import JSZip from 'jszip';

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function parseHtml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/html');
}

function archivePath(base: string, href: string): string {
  const cleanHref = href.split('#')[0].split('?')[0];
  const parts = `${base}${decodeURIComponent(cleanHref)}`.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop();
    else result.push(part);
  }
  return result.join('/');
}

function findZipFile(zip: JSZip, path: string): JSZip.JSZipObject | undefined {
  const candidates = [path, decodeURIComponent(path), encodeURI(path)];
  for (const candidate of candidates) {
    const file = zip.file(candidate);
    if (file) return file;
  }
  return undefined;
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    // Some EPUB converters lose the space after sentence punctuation.
    .replace(/([.!?])(?=[A-ZА-ЯЁ«“])/g, '$1 ')
    .trim();
}

function extractTextFromHtml(htmlText: string): string[] {
  const doc = parseHtml(htmlText);
  const paragraphs: string[] = [];
  doc.querySelectorAll('script, style, head, nav, header, footer').forEach(el => el.remove());

  const add = (value: string | null | undefined) => {
    const text = normalizeText(value || '');
    if (text && text.length > 15 && !paragraphs.includes(text)) paragraphs.push(text);
  };

  doc.querySelectorAll('p').forEach(p => add(p.textContent));
  if (paragraphs.length === 0) {
    doc.querySelectorAll('div, section, article, blockquote').forEach(el => {
      if (el.children.length === 0 || !el.querySelector('div, section, article')) add(el.textContent);
    });
  }
  if (paragraphs.length === 0) {
    (doc.body?.textContent || '').split(/\n{2,}/).forEach(chunk => add(chunk));
  }
  return paragraphs;
}

async function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

type ManifestItem = { id: string; href: string; mediaType: string; properties: string };

async function imageDataUrl(zip: JSZip, item: ManifestItem): Promise<string | undefined> {
  const file = findZipFile(zip, item.href);
  if (!file) return undefined;
  const bytes = await file.async('uint8array');
  return fileToBase64(new Blob([bytes.buffer as ArrayBuffer], { type: item.mediaType || 'image/jpeg' }));
}

async function findImageInCoverPage(zip: JSZip, page: ManifestItem, manifest: ManifestItem[]): Promise<string | undefined> {
  const file = findZipFile(zip, page.href);
  if (!file) return undefined;
  const doc = parseHtml(await file.async('text'));
  const source = doc.querySelector('img')?.getAttribute('src') || doc.querySelector('image')?.getAttribute('href');
  if (!source) return undefined;
  const imageHref = archivePath(page.href.slice(0, page.href.lastIndexOf('/') + 1), source);
  const imageItem = manifest.find(item => item.href === imageHref || decodeURIComponent(item.href) === imageHref);
  if (!imageItem) return undefined;
  return imageDataUrl(zip, imageItem);
}

async function extractImagesFromHtml(zip: JSZip, page: ManifestItem, manifest: ManifestItem[]): Promise<string[]> {
  const file = findZipFile(zip, page.href);
  if (!file) return [];
  const doc = parseHtml(await file.async('text'));
  const imageUrls: string[] = [];
  for (const node of Array.from(doc.querySelectorAll('img'))) {
    const source = node.getAttribute('src');
    if (!source) continue;
    const imageHref = archivePath(page.href.slice(0, page.href.lastIndexOf('/') + 1), source);
    const imageItem = manifest.find(item => item.href === imageHref || decodeURIComponent(item.href) === imageHref);
    if (!imageItem?.mediaType.startsWith('image/')) continue;
    const dataUrl = await imageDataUrl(zip, imageItem);
    if (dataUrl) imageUrls.push(dataUrl);
  }
  return imageUrls;
}

export async function parseEpub(file: File): Promise<{
  title: string;
  author: string;
  coverUrl?: string;
  chapters: { title: string; paragraphs: string[]; images?: string[] }[];
}> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const containerXml = await findZipFile(zip, 'META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Not a valid EPUB: missing container.xml');
  const containerDoc = parseXml(containerXml);
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Cannot find OPF path in container.xml');

  const opfFile = findZipFile(zip, opfPath);
  const opfText = await opfFile?.async('text');
  if (!opfText) throw new Error('Cannot read OPF file');
  const opfDoc = parseXml(opfText);
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const title = opfDoc.querySelector('metadata > *|title, metadata > title')?.textContent?.trim()
    || file.name.replace(/\.epub$/i, '');
  const author = opfDoc.querySelector('metadata > *|creator, metadata > creator')?.textContent?.trim()
    || 'Unknown Author';

  const manifest: ManifestItem[] = [];
  opfDoc.querySelectorAll('manifest item').forEach(node => {
    const id = node.getAttribute('id');
    const href = node.getAttribute('href');
    if (id && href) {
      manifest.push({
        id,
        href: archivePath(opfDir, href),
        mediaType: node.getAttribute('media-type') || '',
        properties: node.getAttribute('properties') || '',
      });
    }
  });

  let coverUrl: string | undefined;
  try {
    const coverImage = manifest.find(item => item.properties.split(/\s+/).includes('cover-image'));
    const legacyCoverId = Array.from(opfDoc.querySelectorAll('meta')).find(node => (node.getAttribute('name') || '').toLowerCase() === 'cover')?.getAttribute('content');
    const legacyCover = legacyCoverId ? manifest.find(item => item.id === legacyCoverId) : undefined;
    const guideHref = Array.from(opfDoc.querySelectorAll('guide reference')).find(node => (node.getAttribute('type') || '').toLowerCase() === 'cover')?.getAttribute('href');
    const guideItem = guideHref
      ? manifest.find(item => item.href === archivePath(opfDir, guideHref))
      : undefined;
    const namedCover = manifest.find(item => item.mediaType.startsWith('image/') && /(^|\/)(frontcover|cover-image|cover)([-_.]|\/|$)/i.test(item.href));

    for (const candidate of [coverImage, legacyCover, namedCover]) {
      if (candidate && candidate.mediaType.startsWith('image/')) {
        coverUrl = await imageDataUrl(zip, candidate);
        if (coverUrl) break;
      }
    }
    if (!coverUrl && guideItem) {
      coverUrl = guideItem.mediaType.startsWith('image/')
        ? await imageDataUrl(zip, guideItem)
        : await findImageInCoverPage(zip, guideItem, manifest);
    }
    if (!coverUrl) {
      const firstImage = manifest.find(item => item.mediaType.startsWith('image/'));
      if (firstImage) coverUrl = await imageDataUrl(zip, firstImage);
    }
  } catch {
    // A missing or malformed cover must not prevent opening the book.
  }

  const spineIds = Array.from(opfDoc.querySelectorAll('spine itemref'))
    .map(node => node.getAttribute('idref'))
    .filter((id): id is string => Boolean(id));
  const chapters: { title: string; paragraphs: string[]; images?: string[] }[] = [];
  let chapterNum = 0;

  for (const id of spineIds) {
    const item = manifest.find(entry => entry.id === id);
    if (!item || (!item.mediaType.includes('html') && !/\.(html?|xhtml)$/i.test(item.href))) continue;
    try {
      const htmlFile = findZipFile(zip, item.href);
      const htmlText = await htmlFile?.async('text');
      if (!htmlText) continue;
      const paragraphs = extractTextFromHtml(htmlText);
      if (!paragraphs.length) continue;
      const images = await extractImagesFromHtml(zip, item, manifest);
      chapterNum++;
      const heading = parseHtml(htmlText).querySelector('h1, h2, h3')?.textContent?.trim();
      const chapterTitle = normalizeText(heading || `Chapter ${chapterNum}`);
      if (paragraphs.length < 3 && chapters.length > 0) {
        chapters[chapters.length - 1].paragraphs.push(...paragraphs);
        chapters[chapters.length - 1].images = [...(chapters[chapters.length - 1].images || []), ...images];
      } else {
        chapters.push({ title: chapterTitle, paragraphs, images });
      }
    } catch {
      // Skip a broken spine item and continue with the readable chapters.
    }
  }

  if (!chapters.length) throw new Error('Could not extract any text from this EPUB file.');
  return { title, author, coverUrl, chapters };
}