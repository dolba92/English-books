import JSZip from 'jszip';

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function parseHtml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/html');
}

function archivePath(base: string, href: string): string {
  const cleanHref = href.split('#')[0].split('?')[0];
  const parts = `${base}${safeDecode(cleanHref)}`.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop();
    else result.push(part);
  }
  return result.join('/');
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function normalizeArchiveKey(value: string): string {
  return safeDecode(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function findZipFile(zip: JSZip, path: string): JSZip.JSZipObject | undefined {
  const clean = path.replace(/^\/+/, '');
  const candidates = [clean, safeDecode(clean)];
  for (const candidate of candidates) {
    const file = zip.file(candidate);
    if (file) return file;
  }

  const wanted = normalizeArchiveKey(clean);
  return Object.values(zip.files).find(file => !file.dir && normalizeArchiveKey(file.name) === wanted);
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

function isNavigationLikeSpineItem(item: ManifestItem, htmlText: string, paragraphs: string[]): boolean {
  const properties = item.properties.toLowerCase().split(/\s+/).filter(Boolean);
  const href = item.href.toLowerCase();

  // EPUB3 navigation documents and the common EPUB2/converted TOC filenames
  // are metadata/navigation, not prose that should appear in the reader.
  if (properties.includes('nav')) return true;
  if (/(^|\/)(toc|contents?|navigation|nav|landmarks?)([-_.\/]|$)/i.test(href)) return true;

  const doc = parseHtml(htmlText);
  if (doc.querySelector('nav[epub\\:type="toc"], nav[role="doc-toc"], nav#toc, nav.toc')) return true;

  const bodyText = normalizeText(doc.body?.textContent || '');
  const links = Array.from(doc.querySelectorAll('a'));
  const linkText = normalizeText(links.map(link => link.textContent || '').join(' '));
  const linkChars = linkText.length;
  const bodyChars = Math.max(1, bodyText.length);
  const linkDensity = linkChars / bodyChars;

  const shortEntries = paragraphs.filter(p => p.length <= 90);
  const tocWords = paragraphs.filter(p =>
    /^(chapter|part|prologue|epilogue|acknowledg(e)?ments?|about the (author|publisher)|contents?)\b/i.test(p.trim()),
  );

  // Some publishers put a plain XHTML contents page in the spine without
  // marking it as `nav`. High link density plus many short chapter-like rows is
  // a strong signal that this is navigation rather than book prose.
  if (links.length >= 4 && linkDensity >= 0.55 && shortEntries.length >= 4) return true;
  if (links.length >= 3 && tocWords.length >= 3 && linkDensity >= 0.35) return true;

  return false;
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
  const seen = new Set<string>();

  const sources: string[] = [];
  doc.querySelectorAll('img').forEach(node => {
    const src = node.getAttribute('src');
    if (src) sources.push(src);
    const srcset = node.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach(part => {
        const candidate = part.trim().split(/\s+/)[0];
        if (candidate) sources.push(candidate);
      });
    }
  });
  doc.querySelectorAll('image').forEach(node => {
    const src = node.getAttribute('href') || node.getAttribute('xlink:href');
    if (src) sources.push(src);
  });

  for (const source of sources) {
    if (/^data:image\//i.test(source)) {
      if (!seen.has(source)) { seen.add(source); imageUrls.push(source); }
      continue;
    }

    const imageHref = archivePath(page.href.slice(0, page.href.lastIndexOf('/') + 1), source);
    const imageItem = manifest.find(item => normalizeArchiveKey(item.href) === normalizeArchiveKey(imageHref));
    let dataUrl: string | undefined;

    if (imageItem?.mediaType.startsWith('image/')) {
      dataUrl = await imageDataUrl(zip, imageItem);
    } else {
      const imageFile = findZipFile(zip, imageHref);
      if (imageFile) {
        const bytes = await imageFile.async('uint8array');
        const ext = imageHref.split('.').pop()?.toLowerCase();
        const mime = ext === 'png' ? 'image/png'
          : ext === 'gif' ? 'image/gif'
          : ext === 'webp' ? 'image/webp'
          : ext === 'svg' ? 'image/svg+xml'
          : 'image/jpeg';
        dataUrl = await fileToBase64(new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
      }
    }

    if (dataUrl && !seen.has(dataUrl)) {
      seen.add(dataUrl);
      imageUrls.push(dataUrl);
    }
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
      const images = await extractImagesFromHtml(zip, item, manifest);
      if (!paragraphs.length && !images.length) continue;
      if (paragraphs.length && isNavigationLikeSpineItem(item, htmlText, paragraphs)) continue;
      const headingText = parseHtml(htmlText).querySelector('h1, h2, h3')?.textContent?.trim();
      const heading = normalizeText(headingText || '');
      const previous = chapters[chapters.length - 1];

      // EPUB spine items are files, not necessarily chapters. Many publishers
      // split one visible chapter across several XHTML files. Treating every
      // spine item as a chapter forced a hard page break at each file boundary,
      // which produced pages with only a few short paragraphs and a huge blank
      // lower half. A file with no heading is therefore a continuation of the
      // current chapter; a repeated heading is also a continuation.
      const repeatsPreviousHeading = Boolean(
        previous && heading && previous.title.trim().toLowerCase() === heading.toLowerCase(),
      );
      const isContinuation = Boolean(previous && (!heading || repeatsPreviousHeading));

      if (isContinuation) {
        previous.paragraphs.push(...paragraphs);
        previous.images = [...(previous.images || []), ...images];
      } else {
        chapterNum++;
        const chapterTitle = heading || `Chapter ${chapterNum}`;
        chapters.push({ title: chapterTitle, paragraphs, images });
      }
    } catch {
      // Skip a broken spine item and continue with the readable chapters.
    }
  }

  if (!chapters.length) throw new Error('Could not extract any text from this EPUB file.');
  return { title, author, coverUrl, chapters };
}
