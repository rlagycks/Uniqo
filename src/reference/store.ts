import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  ReferenceEntry,
  ReferenceInput,
  ReferenceSource,
  PaperResult,
  SemanticScholarPaper,
  OpenAlexWork,
  CrossRefWork,
} from '../types/index.js';
import { referenceParser } from './parser.js';
import { generateCitationKey } from './citation.js';
import { contextManager } from '../context/manager.js';
import { vectorStore } from '../context/vector-store.js';
import {
  chunkPdfText,
  chunkPptSlides,
  chunkReportText,
  chunkGenericText,
} from '../context/chunker.js';

const REFS_DIR = path.join(os.homedir(), '.uni-agent', 'references');
const INDEX_PATH = path.join(REFS_DIR, 'index.json');
const ORIGINALS_DIR = path.join(REFS_DIR, 'originals');

interface ReferenceIndex {
  entries: ReferenceEntry[];
  lastId: number;
}

export class ReferenceStore {
  private index: ReferenceIndex = { entries: [], lastId: 0 };
  private citationKeys: Set<string> = new Set();
  private loaded = false;

  private load(): void {
    if (this.loaded) return;
    fs.mkdirSync(REFS_DIR, { recursive: true });
    fs.mkdirSync(ORIGINALS_DIR, { recursive: true });

    if (fs.existsSync(INDEX_PATH)) {
      const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
      this.index = JSON.parse(raw) as ReferenceIndex;
      for (const e of this.index.entries) {
        this.citationKeys.add(e.citationKey);
      }
    }
    this.loaded = true;
  }

  private save(): void {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(this.index, null, 2), 'utf-8');
  }

  private nextId(): string {
    this.index.lastId += 1;
    return `ref_${String(this.index.lastId).padStart(3, '0')}`;
  }

  async add(input: ReferenceInput): Promise<ReferenceEntry> {
    this.load();

    let parsed: {
      text: string;
      metadata: { title?: string; authors?: string[]; year?: number; abstract?: string };
      slides?: Array<{ index: number; text: string; notes?: string }>;
    };
    let source: ReferenceSource;
    let filePath: string | undefined;
    let doi: string | undefined;
    let url: string | undefined;

    if (input.type === 'api_result' && input.apiResult) {
      // Semantic Scholar / RISS API 결과 직접 등록
      return this.addFromApiResult(input.apiResult);
    }

    if (input.type === 'file' && input.filePath) {
      parsed = await referenceParser.parseFile(input.filePath);
      source = this.detectFileSource(input.filePath);
      filePath = input.filePath;
    } else if (input.type === 'doi' && input.doi) {
      parsed = await referenceParser.parseDoi(input.doi);
      source = 'doi';
      doi = input.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
      url = `https://doi.org/${doi}`;
    } else if (input.type === 'url' && input.url) {
      parsed = await referenceParser.parseUrl(input.url);
      source = 'url';
      url = input.url;
    } else {
      throw new Error('Invalid ReferenceInput');
    }

    const authors = parsed.metadata.authors ?? [];
    const year = parsed.metadata.year ?? new Date().getFullYear();
    const title = parsed.metadata.title ?? 'Untitled';
    const citationKey = generateCitationKey(authors.length > 0 ? authors : ['unknown'], year, this.citationKeys);

    const id = this.nextId();

    // 청킹 + 임베딩 + Vector Store 저장
    const ext = filePath ? path.extname(filePath).toLowerCase() : '';
    const chunks = await this.chunkAndEmbed(id, parsed, ext);

    const entry: ReferenceEntry = {
      id,
      title,
      authors,
      year,
      doi,
      url,
      source,
      chunkIds: chunks.map((c) => c.id),
      usedIn: [],
      citationKey,
      addedAt: new Date().toISOString(),
      filePath,
    };

    this.index.entries.push(entry);
    this.citationKeys.add(citationKey);
    this.save();

    // 청크를 Vector Store에 저장
    for (const chunk of chunks) {
      await vectorStore.add(chunk);
    }

    return entry;
  }

  async addFromApiResult(
    paper: SemanticScholarPaper | OpenAlexWork | CrossRefWork | { title: string; url?: string; content?: string },
  ): Promise<ReferenceEntry> {
    this.load();

    let title: string;
    let authors: string[];
    let year: number;
    let doi: string | undefined;
    let url: string | undefined;
    let source: ReferenceSource;
    let abstract: string | undefined;

    if ('paperId' in paper) {
      const ss = paper as SemanticScholarPaper;
      title = ss.title;
      authors = ss.authors.map((a) => a.name);
      year = ss.year;
      doi = ss.externalIds?.DOI;
      source = 'semantic_scholar';
      abstract = ss.abstract;
    } else if ('authorships' in paper) {
      const oa = paper as OpenAlexWork;
      title = oa.title;
      authors = oa.authorships.map((a) => a.author.display_name);
      year = oa.publication_year ?? new Date().getFullYear();
      doi = oa.doi?.replace('https://doi.org/', '');
      url = oa.doi ? `https://doi.org/${doi}` : oa.id;
      source = 'openalex';
      if (oa.abstract_inverted_index) {
        const positions: Array<[number, string]> = [];
        for (const [word, idxs] of Object.entries(oa.abstract_inverted_index)) {
          for (const idx of idxs) positions.push([idx, word]);
        }
        abstract = positions.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join(' ');
      }
    } else if ('DOI' in paper) {
      const cr = paper as CrossRefWork;
      title = Array.isArray(cr.title) ? (cr.title[0] ?? '') : (cr.title as string);
      authors = (cr.author ?? []).map((a) => `${a.given ?? ''} ${a.family ?? ''}`.trim());
      year = cr['published-print']?.['date-parts']?.[0]?.[0] ?? new Date().getFullYear();
      doi = cr.DOI;
      url = `https://doi.org/${cr.DOI}`;
      source = 'crossref';
      abstract = cr.abstract;
    } else {
      // Generic fallback (e.g. plugin result)
      const gen = paper as { title: string; url?: string; content?: string };
      title = gen.title;
      authors = [];
      year = new Date().getFullYear();
      url = gen.url;
      source = 'url';
      abstract = gen.content;
    }

    const citationKey = generateCitationKey(
      authors.length > 0 ? authors : ['unknown'],
      year,
      this.citationKeys,
    );
    const id = this.nextId();

    // abstract 텍스트 청킹
    const text = abstract ?? title;
    const rawChunks = chunkGenericText(id, text);
    const chunks = await Promise.all(
      rawChunks.map(async (chunk) => {
        chunk.embedding = await contextManager.embed(chunk.text);
        return chunk;
      }),
    );

    const entry: ReferenceEntry = {
      id,
      title,
      authors,
      year,
      doi,
      url,
      source,
      chunkIds: chunks.map((c) => c.id),
      usedIn: [],
      citationKey,
      addedAt: new Date().toISOString(),
    };

    this.index.entries.push(entry);
    this.citationKeys.add(citationKey);
    this.save();

    for (const chunk of chunks) {
      await vectorStore.add(chunk);
    }

    return entry;
  }

  async addPaperResult(paper: PaperResult): Promise<ReferenceEntry> {
    this.load();

    const citationKey = generateCitationKey(
      paper.authors.length > 0 ? paper.authors : ['unknown'],
      paper.year,
      this.citationKeys,
    );
    const id = this.nextId();

    const text = paper.abstract ?? paper.title;
    const rawChunks = chunkGenericText(id, text);
    const chunks = await Promise.all(
      rawChunks.map(async (chunk) => {
        chunk.embedding = await contextManager.embed(chunk.text);
        return chunk;
      }),
    );

    const entry: ReferenceEntry = {
      id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      doi: paper.doi,
      url: paper.url,
      source: paper.source as ReferenceSource,
      chunkIds: chunks.map((c) => c.id),
      usedIn: [],
      citationKey,
      addedAt: new Date().toISOString(),
    };

    this.index.entries.push(entry);
    this.citationKeys.add(citationKey);
    this.save();

    for (const chunk of chunks) {
      await vectorStore.add(chunk);
    }

    return entry;
  }

  get(refId: string): ReferenceEntry | null {
    this.load();
    return this.index.entries.find((e) => e.id === refId) ?? null;
  }

  list(filter?: { source?: ReferenceSource; year?: number }): ReferenceEntry[] {
    this.load();
    let entries = this.index.entries;
    if (filter?.source) entries = entries.filter((e) => e.source === filter.source);
    if (filter?.year) entries = entries.filter((e) => e.year === filter.year);
    return entries;
  }

  delete(refId: string): boolean {
    this.load();
    const idx = this.index.entries.findIndex((e) => e.id === refId);
    if (idx === -1) return false;

    const entry = this.index.entries[idx]!;
    this.index.entries.splice(idx, 1);
    this.citationKeys.delete(entry.citationKey);

    // Vector Store에서도 삭제
    vectorStore.deleteByRefId(refId).catch(() => {});
    this.save();
    return true;
  }

  markAsUsed(refId: string, location: string): void {
    this.load();
    const entry = this.index.entries.find((e) => e.id === refId);
    if (entry && !entry.usedIn.includes(location)) {
      entry.usedIn.push(location);
      this.save();
    }
  }

  private async chunkAndEmbed(
    refId: string,
    parsed: {
      text: string;
      metadata: { abstract?: string };
      slides?: Array<{ index: number; text: string; notes?: string }>;
    },
    ext: string,
  ) {
    let rawChunks;

    if (ext === '.pdf') {
      rawChunks = chunkPdfText(refId, parsed.text, parsed.metadata.abstract);
    } else if (ext === '.pptx' && parsed.slides) {
      rawChunks = chunkPptSlides(refId, parsed.slides);
    } else if (ext === '.docx' || ext === '.md') {
      rawChunks = chunkReportText(refId, parsed.text);
    } else {
      rawChunks = chunkGenericText(refId, parsed.text);
    }

    // 임베딩 계산
    const chunks = await Promise.all(
      rawChunks.map(async (chunk) => {
        chunk.embedding = await contextManager.embed(chunk.text);
        return chunk;
      }),
    );

    return chunks;
  }

  private detectFileSource(filePath: string): ReferenceSource {
    const ext = path.extname(filePath).toLowerCase();
    const sources: Record<string, ReferenceSource> = {
      '.pdf': 'pdf',
      '.pptx': 'pptx',
      '.docx': 'docx',
      '.png': 'url',
      '.jpg': 'url',
      '.jpeg': 'url',
    };
    return sources[ext] ?? 'url';
  }
}

export const referenceStore = new ReferenceStore();
