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
}

let dbPromise: Promise<IDBPDatabase<LoveTexasDB>> | null = null;

async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<LoveTexasDB>('love-texas-db', 1, {
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
      },
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
