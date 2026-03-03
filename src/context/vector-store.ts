import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Chunk } from '../types/index.js';

const STORE_DIR = path.join(os.homedir(), '.uni-agent', 'vector-store');
const METADATA_PATH = path.join(STORE_DIR, 'metadata.json');
const INDEX_PATH = path.join(STORE_DIR, 'index.bin');

interface StoredMetadata {
  [chunkId: string]: Omit<Chunk, 'embedding'>;
}

interface SearchResult {
  chunk: Chunk;
  distance: number;
}

export class VectorStore {
  private metadata: StoredMetadata = {};
  private embeddings: Map<string, number[]> = new Map();
  private initialized = false;
  // hnswlib is loaded dynamically to handle optional native dependency
  private index: HnswIndex | null = null;
  private dimension: number;

  constructor() {
    this.dimension = process.env['VOYAGE_API_KEY'] ? 1024 : 1536;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    fs.mkdirSync(STORE_DIR, { recursive: true });

    if (fs.existsSync(METADATA_PATH)) {
      const raw = fs.readFileSync(METADATA_PATH, 'utf-8');
      this.metadata = JSON.parse(raw) as StoredMetadata;
    }

    // Load embeddings from separate file
    const embeddingPath = path.join(STORE_DIR, 'embeddings.json');
    if (fs.existsSync(embeddingPath)) {
      const raw = fs.readFileSync(embeddingPath, 'utf-8');
      const stored = JSON.parse(raw) as Record<string, number[]>;
      for (const [id, vec] of Object.entries(stored)) {
        this.embeddings.set(id, vec);
      }
    }

    // Detect dimension mismatch (e.g. switching between Voyage and local embeddings)
    const firstVec = [...this.embeddings.values()][0];
    if (firstVec && firstVec.length !== this.dimension) {
      console.error(`[vector-store] dimension mismatch (stored=${firstVec.length}, current=${this.dimension}). Clearing index.`);
      this.embeddings.clear();
      this.metadata = {};
      this.index = null;
    }

    try {
      const { HierarchicalNSW } = await import('hnswlib-node');
      const idx = new HierarchicalNSW('cosine', this.dimension) as unknown as HnswIndex;
      this.index = idx;

      if (fs.existsSync(INDEX_PATH) && this.embeddings.size > 0) {
        this.index.readIndex(INDEX_PATH, this.embeddings.size + 100);
      } else {
        this.index.initIndex(10000);
      }
    } catch {
      // hnswlib not available — fall back to brute-force cosine search
      this.index = null;
    }

    this.initialized = true;
  }

  async add(chunk: Chunk): Promise<void> {
    await this.initialize();

    this.metadata[chunk.id] = {
      id: chunk.id,
      refId: chunk.refId,
      text: chunk.text,
      metadata: chunk.metadata,
    };
    this.embeddings.set(chunk.id, chunk.embedding);

    if (this.index) {
      const label = this.chunkIdToLabel(chunk.id);
      if (!this.index.hasPoint(label)) {
        this.index.addPoint(chunk.embedding, label);
      } else {
        this.index.markDelete(label);
        this.index.addPoint(chunk.embedding, label);
      }
      this.index.writeIndex(INDEX_PATH);
    }

    this.persistMetadata();
    this.persistEmbeddings();
  }

  async search(queryEmbedding: number[], topK = 4): Promise<SearchResult[]> {
    await this.initialize();

    if (this.embeddings.size === 0) return [];

    if (this.index && this.index.getCurrentCount() > 0) {
      const k = Math.min(topK, this.index.getCurrentCount());
      const result = this.index.searchKnn(queryEmbedding, k);
      return result.neighbors.map((label, i) => {
        const chunkId = this.labelToChunkId(label);
        const meta = this.metadata[chunkId];
        const embedding = this.embeddings.get(chunkId) ?? [];
        return {
          chunk: { ...meta, embedding } as Chunk,
          distance: result.distances[i] ?? 0,
        };
      });
    }

    // Brute-force fallback
    return this.bruteForceSearch(queryEmbedding, topK);
  }

  async deleteByRefId(refId: string): Promise<void> {
    await this.initialize();

    const toDelete = Object.values(this.metadata).filter((m) => m.refId === refId);

    for (const chunk of toDelete) {
      if (this.index) {
        const label = this.chunkIdToLabel(chunk.id);
        try {
          this.index.markDelete(label);
        } catch {
          // already deleted
        }
      }
      delete this.metadata[chunk.id];
      this.embeddings.delete(chunk.id);
    }

    if (this.index && toDelete.length > 0) {
      this.index.writeIndex(INDEX_PATH);
    }

    this.persistMetadata();
    this.persistEmbeddings();
  }

  private bruteForceSearch(queryVec: number[], topK: number): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, vec] of this.embeddings.entries()) {
      const distance = this.cosineDistance(queryVec, vec);
      const meta = this.metadata[id];
      if (meta) {
        results.push({ chunk: { ...meta, embedding: vec } as Chunk, distance });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, topK);
  }

  private cosineDistance(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) ** 2;
      normB += (b[i] ?? 0) ** 2;
    }
    if (normA === 0 || normB === 0) return 1;
    return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private chunkIdToLabel(chunkId: string): number {
    // Generate stable numeric label from chunk id
    const ids = Object.keys(this.metadata);
    const idx = ids.indexOf(chunkId);
    return idx >= 0 ? idx : ids.length;
  }

  private labelToChunkId(label: number): string {
    const ids = Object.keys(this.metadata);
    return ids[label] ?? '';
  }

  private persistMetadata(): void {
    fs.writeFileSync(METADATA_PATH, JSON.stringify(this.metadata, null, 2), 'utf-8');
  }

  private persistEmbeddings(): void {
    const embeddingPath = path.join(STORE_DIR, 'embeddings.json');
    const obj: Record<string, number[]> = {};
    for (const [id, vec] of this.embeddings.entries()) {
      obj[id] = vec;
    }
    fs.writeFileSync(embeddingPath, JSON.stringify(obj), 'utf-8');
  }
}

// Type stub for hnswlib-node (dynamic import)
interface HnswIndex {
  initIndex(maxElements: number): void;
  readIndex(path: string, maxElements: number): void;
  writeIndex(path: string): void;
  addPoint(vec: number[], label: number): void;
  markDelete(label: number): void;
  hasPoint(label: number): boolean;
  searchKnn(vec: number[], k: number): { neighbors: number[]; distances: number[] };
  getCurrentCount(): number;
}

export const vectorStore = new VectorStore();
