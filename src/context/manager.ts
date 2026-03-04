import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Chunk, SessionState, StepLog, UserProfile } from '../types/index.js';
import { vectorStore } from './vector-store.js';

const SESSIONS_DIR = path.join(os.homedir(), '.uni-agent', 'sessions');
const EMBEDDING_CACHE_PATH = path.join(os.homedir(), '.uni-agent', 'embedding-cache.json');

// 토큰 예산 (문자 기준 근사치: 1 token ≈ 4 chars)
const TOKEN_BUDGET = {
  system: 2_000 * 4,    // 8K chars
  session: 10_000 * 4,  // 40K chars
  working: 20_000 * 4,  // 80K chars
  retrieved: 8_000 * 4, // 32K chars
} as const;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
const EMBEDDING_DIM = 768;

interface EmbeddingCacheEntry {
  embedding: number[];
  createdAt: number;
}

interface EmbeddingCache {
  [text: string]: EmbeddingCacheEntry;
}

interface SearchCache {
  [query: string]: { result: Chunk[]; expiresAt: number };
}

export class ContextManager {
  private embeddingCache: EmbeddingCache = {};
  private searchCache: SearchCache = {};
  private workingChunks: Chunk[] = [];
  private sessionCache: Map<string, SessionState> = new Map();

  constructor() {
    this.loadEmbeddingCache();
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  // ─── 임베딩 ───────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    const cached = this.embeddingCache[text];
    if (cached) return cached.embedding;

    const embedding = await this.computeLocalEmbedding(text);

    this.embeddingCache[text] = { embedding, createdAt: Date.now() };
    this.persistEmbeddingCache();
    return embedding;
  }

  private async computeLocalEmbedding(text: string): Promise<number[]> {
    try {
      const { pipeline } = await import('@xenova/transformers');
      const embedder = await pipeline('feature-extraction', 'Xenova/multilingual-e5-base');
      const output = await embedder(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data) as number[];
    } catch {
      // fallback: TF 기반 더미 벡터
      return this.computeFallbackEmbedding(text);
    }
  }

  private computeFallbackEmbedding(text: string): number[] {
    const vec = new Array<number>(EMBEDDING_DIM).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        const idx = (charCode * 31 + i * 17) % EMBEDDING_DIM;
        vec[idx] = (vec[idx] ?? 0) + 1 / words.length;
      }
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  }

  getEmbeddingDimension(): number {
    return EMBEDDING_DIM;
  }

  // ─── 청크 검색 ───────────────────────────────────────────

  async getRelevantChunks(query: string, topK = 4): Promise<Chunk[]> {
    const cacheKey = `${query}::${topK}`;
    const cached = this.searchCache[cacheKey];
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    const queryEmbedding = await this.embed(query);
    const results = await vectorStore.search(queryEmbedding, topK);
    const chunks = results.map((r) => r.chunk);

    this.workingChunks = chunks;

    this.searchCache[cacheKey] = {
      result: chunks,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return chunks;
  }

  clearWorkingChunks(): void {
    this.workingChunks = [];
  }

  getWorkingChunks(): Chunk[] {
    return this.workingChunks;
  }

  buildRetrievedContext(chunks: Chunk[]): string {
    const parts = chunks.map((c, i) => {
      const src = `[출처 ${i + 1}: ref ${c.refId}]`;
      const truncated = c.text.slice(0, TOKEN_BUDGET.retrieved / (chunks.length || 1));
      return `${src}\n${truncated}`;
    });
    return parts.join('\n\n---\n\n');
  }

  compressCompletedStage(stageLog: StepLog[]): string {
    const lines = stageLog.map(
      (l) => `[${l.agent}/${l.step}] ${l.message}`,
    );
    return `## 완료된 단계 요약\n${lines.join('\n')}`;
  }

  // ─── 세션 관리 ───────────────────────────────────────────

  async loadSession(sessionId: string): Promise<SessionState | null> {
    if (this.sessionCache.has(sessionId)) {
      return this.sessionCache.get(sessionId)!;
    }

    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const session = JSON.parse(raw) as SessionState;
    this.sessionCache.set(sessionId, session);
    return session;
  }

  async saveSession(session: SessionState): Promise<void> {
    session.updatedAt = new Date().toISOString();
    this.sessionCache.set(session.sessionId, session);

    const filePath = path.join(SESSIONS_DIR, `${session.sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async createSession(sessionId: string, profile?: Partial<UserProfile>): Promise<SessionState> {
    const now = new Date().toISOString();
    const session: SessionState = {
      sessionId,
      userProfile: {
        preferredLanguage: 'ko',
        ...profile,
      },
      referenceLibrary: [],
      taskHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.saveSession(session);
    return session;
  }

  // ─── 내부 유틸 ───────────────────────────────────────────

  private loadEmbeddingCache(): void {
    if (fs.existsSync(EMBEDDING_CACHE_PATH)) {
      try {
        const raw = fs.readFileSync(EMBEDDING_CACHE_PATH, 'utf-8');
        this.embeddingCache = JSON.parse(raw) as EmbeddingCache;
      } catch {
        this.embeddingCache = {};
      }
    }
  }

  private persistEmbeddingCache(): void {
    fs.mkdirSync(path.dirname(EMBEDDING_CACHE_PATH), { recursive: true });
    fs.writeFileSync(EMBEDDING_CACHE_PATH, JSON.stringify(this.embeddingCache), 'utf-8');
  }
}

export const contextManager = new ContextManager();
