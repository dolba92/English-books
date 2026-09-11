import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface BookChapter {
  title: string;
  paragraphs: string[];
  images?: string[];
}

export interface Book {
  id?: number;
  title: string;
  author: string;
  level: string; // A1, A2, B1, B2, C1
  coverUrl?: string; // data URL
  content: BookChapter[];
  fileSizeKb: number;
  addedAt: number; // timestamp
  totalPages: number;
}

export interface BookProgress {
  bookId: number;
  currentChapterIndex: number;
  currentPage: number;
  totalPagesRead: number;
  lastReadAt: number; // timestamp
  percentComplete: number;
}

export interface DictionaryWord {
  id?: number;
  word: string;
  translation: string;
  transcription?: string;
  partOfSpeech?: string;
  dateAdded: number; // timestamp
  errorCount: number;
  // SRS (Spaced Repetition System) fields
  nextReviewAt?: number;    // timestamp — когда показать снова
  interval?: number;        // дней до следующего показа
  easeFactor?: number;      // коэффициент лёгкости (SM-2)
  reviewCount?: number;     // сколько раз повторено
  successStreak?: number;   // подряд правильных ответов (>= 3 → "знаю")
}

export interface AppStats {
  id: 'global';
  totalBooksRead: number;
  totalPagesRead: number;
  totalWordsAdded: number;
  totalTrainingsDone: number;
  lastActiveAt: number;
  firstUsed: number;
}

export interface PaginationCachePage {
  title: string;
  blocks: Array<
    | { kind: 'heading'; title: string; images?: string[] }
    | { kind: 'paragraph'; text: string }
  >;
}

export interface PaginationCacheEntry {
  key: string;
  bookId: number;
  pages: PaginationCachePage[];
  createdAt: number;
}

interface LoveTexasDB extends DBSchema {
  books: {
    key: number;
    value: Book;
  };
  progress: {
    key: number;
    value: BookProgress;
  };
  dictionary: {
    key: number;
    value: DictionaryWord;
    indexes: { 'by-word': string };
  };
  stats: {
    key: string;
    value: AppStats;
  };
  paginationCache: {
    key: string;
    value: PaginationCacheEntry;
    indexes: { 'by-book': number };
  };
}

let dbPromise: Promise<IDBPDatabase<LoveTexasDB>> | null = null;

function openMainDB() {
  return openDB<LoveTexasDB>('love-texas-db', 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('dictionary')) {
        const dictStore = db.createObjectStore('dictionary', { keyPath: 'id', autoIncrement: true });
        dictStore.createIndex('by-word', 'word', { unique: false });
      }
      if (!db.objectStoreNames.contains('stats')) {
        db.createObjectStore('stats', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('paginationCache')) {
        const cacheStore = db.createObjectStore('paginationCache', { keyPath: 'key' });
        cacheStore.createIndex('by-book', 'bookId', { unique: false });
      }
    },
    blocking() {
      // If another tab needs a newer schema, release this connection.
      dbPromise?.then(db => db.close()).catch(() => {});
      dbPromise = null;
    },
    terminated() {
      dbPromise = null;
    },
  });
}

async function getDB() {
  if (!dbPromise) {
    dbPromise = openMainDB().catch(async (error) => {
      console.warn('IndexedDB v2 open failed, trying existing database without migration:', error);

      // Recovery path: never delete the user's database. If schema migration is
      // unavailable/blocked in this browser, open whatever version already
      // exists so books/progress/dictionary remain usable. Pagination cache is
      // optional and its helpers below gracefully no-op if the store is absent.
      return openDB<LoveTexasDB>('love-texas-db', undefined, {
        blocking() {
          dbPromise?.then(db => db.close()).catch(() => {});
          dbPromise = null;
        },
        terminated() {
          dbPromise = null;
        },
      });
    });
  }
  return dbPromise;
}

// --- BOOKS ---
export async function saveBook(book: Omit<Book, 'id'>): Promise<number> {
  const db = await getDB();
  const id = await db.put('books', book as Book);
  
  // Create empty progress
  await db.put('progress', {
    bookId: id,
    currentChapterIndex: 0,
    currentPage: 0,
    totalPagesRead: 0,
    lastReadAt: Date.now(),
    percentComplete: 0
  });

  return id;
}

export async function getBook(id: number): Promise<Book | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

export async function getAllBooks(): Promise<Book[]> {
  const db = await getDB();
  return db.getAll('books');
}

export async function deleteBook(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('books', id);
  await db.delete('progress', id);
  if (db.objectStoreNames.contains('paginationCache')) {
    const cacheKeys = await db.getAllKeysFromIndex('paginationCache', 'by-book', id);
    const tx = db.transaction('paginationCache', 'readwrite');
    await Promise.all(cacheKeys.map(key => tx.store.delete(key)));
    await tx.done;
  }
}

// --- PAGINATION CACHE ---
export async function getPaginationCache(key: string): Promise<PaginationCacheEntry | undefined> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('paginationCache')) return undefined;
  return db.get('paginationCache', key);
}

export async function savePaginationCache(entry: PaginationCacheEntry): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('paginationCache')) return;
  await db.put('paginationCache', entry);
}

export async function clearPaginationCacheForBook(bookId: number): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('paginationCache')) return;
  const keys = await db.getAllKeysFromIndex('paginationCache', 'by-book', bookId);
  const tx = db.transaction('paginationCache', 'readwrite');
  await Promise.all(keys.map(key => tx.store.delete(key)));
  await tx.done;
}

// --- PROGRESS ---
export async function saveProgress(progress: BookProgress): Promise<void> {
  const db = await getDB();
  await db.put('progress', progress);
}

export async function getProgress(bookId: number): Promise<BookProgress | undefined> {
  const db = await getDB();
  return db.get('progress', bookId);
}

export async function getAllProgress(): Promise<BookProgress[]> {
  const db = await getDB();
  return db.getAll('progress');
}

// --- DICTIONARY ---
export async function addWordToDictionary(word: string, translation: string, transcription?: string, partOfSpeech?: string): Promise<number> {
  const db = await getDB();
  
  // Check if word exists (basic check, could be case sensitive)
  const existing = await db.getFromIndex('dictionary', 'by-word', word.toLowerCase());
  if (existing && existing.id) {
    return existing.id; // already added
  }

  const newWord: Omit<DictionaryWord, 'id'> = {
    word: word.toLowerCase(),
    translation,
    transcription,
    partOfSpeech,
    dateAdded: Date.now(),
    errorCount: 0
  };

  const id = await db.put('dictionary', newWord as DictionaryWord);
  
  const stats = await getStats();
  if (stats) {
    await updateStats({ totalWordsAdded: stats.totalWordsAdded + 1 });
  }
  return id;
}

export async function getDictionaryWords(): Promise<DictionaryWord[]> {
  const db = await getDB();
  return db.getAll('dictionary');
}

export async function removeDictionaryWord(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('dictionary', id);
}

export async function updateWordErrorCount(id: number, increment: number): Promise<void> {
  const db = await getDB();
  const word = await db.get('dictionary', id);
  if (word) {
    word.errorCount = Math.max(0, word.errorCount + increment);
    await db.put('dictionary', word);
  }
}

export async function updateWordSRS(
  id: number,
  patch: Partial<Pick<DictionaryWord, 'nextReviewAt' | 'interval' | 'easeFactor' | 'reviewCount' | 'errorCount' | 'successStreak'>>
): Promise<void> {
  const db = await getDB();
  const word = await db.get('dictionary', id);
  if (word) {
    Object.assign(word, patch);
    await db.put('dictionary', word);
  }
}

export async function clearDictionary(): Promise<void> {
  const db = await getDB();
  await db.clear('dictionary');
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear('books');
  await db.clear('progress');
  await db.clear('dictionary');
  await db.clear('stats');
  if (db.objectStoreNames.contains('paginationCache')) {
    await db.clear('paginationCache');
  }
  await initStats();
}

// --- STATS ---
export async function initStats(): Promise<void> {
  const db = await getDB();
  const stats = await db.get('stats', 'global');
  if (!stats) {
    await db.put('stats', {
      id: 'global',
      totalBooksRead: 0,
      totalPagesRead: 0,
      totalWordsAdded: 0,
      totalTrainingsDone: 0,
      lastActiveAt: Date.now(),
      firstUsed: Date.now()
    });
  } else {
    stats.lastActiveAt = Date.now();
    await db.put('stats', stats);
  }
}

export async function getStats(): Promise<AppStats> {
  const db = await getDB();
  let stats = await db.get('stats', 'global');
  if (!stats) {
    await initStats();
    stats = await db.get('stats', 'global');
  }
  return stats as AppStats;
}

export async function updateStats(patch: Partial<Omit<AppStats, 'id'>>): Promise<void> {
  const db = await getDB();
  const current = await getStats();
  await db.put('stats', { ...current, ...patch });
}

// Ensure stats are initialized on load
initStats().catch(console.error);
