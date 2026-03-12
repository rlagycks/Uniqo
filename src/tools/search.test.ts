import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchSemanticScholar,
  searchOpenAlex,
  searchCrossRef,
  deduplicatePapers,
  searchAll,
  scorePapers,
} from './search.js';
import type { PaperResult } from '../types/index.js';

// ─── fetch mock ────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── searchSemanticScholar ─────────────────────────────────────

describe('searchSemanticScholar', () => {
  it('normalizes results correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: 'abc123',
            title: 'Deep Learning Survey',
            authors: [{ authorId: '1', name: 'LeCun, Y.' }],
            year: 2015,
            abstract: 'A comprehensive survey.',
            externalIds: { DOI: '10.1234/dl' },
          },
        ],
        total: 1,
        offset: 0,
      }),
    });

    const results = await searchSemanticScholar(['deep learning']);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Deep Learning Survey',
      authors: ['LeCun, Y.'],
      year: 2015,
      abstract: 'A comprehensive survey.',
      doi: '10.1234/dl',
      source: 'semantic_scholar',
    });
  });

  it('returns empty array on non-english keywords', async () => {
    const results = await searchSemanticScholar(['딥러닝']);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty array on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const results = await searchSemanticScholar(['machine learning']);
    expect(results).toEqual([]);
  });

  it('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const results = await searchSemanticScholar(['machine learning']);
    expect(results).toEqual([]);
  });
});

// ─── searchOpenAlex ────────────────────────────────────────────

describe('searchOpenAlex', () => {
  it('reconstructs abstract from inverted index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'https://openalex.org/W123',
            title: 'AI Ethics',
            authorships: [{ author: { display_name: 'Smith, J.' } }],
            publication_year: 2022,
            abstract_inverted_index: {
              'This': [0],
              'paper': [1],
              'discusses': [2],
              'ethics': [3],
            },
            doi: 'https://doi.org/10.5678/ai',
          },
        ],
        meta: { count: 1 },
      }),
    });

    const results = await searchOpenAlex(['AI ethics']);
    expect(results).toHaveLength(1);
    expect(results[0]?.abstract).toBe('This paper discusses ethics');
    expect(results[0]?.doi).toBe('10.5678/ai');
    expect(results[0]?.source).toBe('openalex');
  });

  it('handles missing abstract_inverted_index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'https://openalex.org/W999',
            title: 'No Abstract Paper',
            authorships: [],
            publication_year: 2020,
          },
        ],
        meta: { count: 1 },
      }),
    });

    const results = await searchOpenAlex(['topic']);
    expect(results[0]?.abstract).toBeUndefined();
  });

  it('returns empty array on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    const results = await searchOpenAlex(['test']);
    expect(results).toEqual([]);
  });
});

// ─── searchCrossRef ────────────────────────────────────────────

describe('searchCrossRef', () => {
  it('normalizes CrossRef results correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: '10.9999/test',
              title: ['Test Paper Title'],
              author: [{ given: 'John', family: 'Doe' }],
              'published-print': { 'date-parts': [[2021]] },
              abstract: 'Abstract text here.',
            },
          ],
        },
      }),
    });

    const results = await searchCrossRef(['test paper']);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Test Paper Title',
      authors: ['John Doe'],
      year: 2021,
      doi: '10.9999/test',
      source: 'crossref',
      url: 'https://doi.org/10.9999/test',
    });
  });

  it('filters non-english keywords', async () => {
    const results = await searchCrossRef(['한국어']);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty array on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const results = await searchCrossRef(['test']);
    expect(results).toEqual([]);
  });
});

// ─── deduplicatePapers ─────────────────────────────────────────

describe('deduplicatePapers', () => {
  it('removes duplicates by title prefix', () => {
    const papers: PaperResult[] = [
      { title: 'Deep Learning Basics', authors: [], year: 2020, source: 'semantic_scholar' },
      { title: 'Different Paper', authors: [], year: 2021, source: 'openalex' },
      { title: 'Deep Learning Basics', authors: ['Other'], year: 2020, source: 'crossref' },
    ];
    const result = deduplicatePapers(papers);
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe('Deep Learning Basics');
    expect(result[1]?.title).toBe('Different Paper');
  });

  it('preserves order of first occurrence', () => {
    const papers: PaperResult[] = [
      { title: 'Paper A', authors: [], year: 2020, source: 'semantic_scholar' },
      { title: 'Paper B', authors: [], year: 2021, source: 'openalex' },
      { title: 'Paper A', authors: [], year: 2020, source: 'crossref' },
    ];
    const result = deduplicatePapers(papers);
    expect(result.map((p) => p.title)).toEqual(['Paper A', 'Paper B']);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicatePapers([])).toEqual([]);
  });
});

// ─── scorePapers ───────────────────────────────────────────────

describe('scorePapers', () => {
  const currentYear = new Date().getFullYear();

  it('최근 논문이 오래된 논문보다 높은 recency 점수를 받는다', () => {
    const papers: PaperResult[] = [
      { title: 'Old Paper', authors: [], year: 1990, source: 'semantic_scholar' },
      { title: 'Recent Paper', authors: [], year: currentYear, source: 'semantic_scholar' },
    ];
    const result = scorePapers(papers, 'test');
    expect(result[0]?.title).toBe('Recent Paper');
  });

  it('citationCount가 높은 논문이 높은 citation 점수를 받는다', () => {
    const papers: PaperResult[] = [
      { title: 'Low Cited', authors: [], year: currentYear, citationCount: 10, source: 'semantic_scholar' },
      { title: 'High Cited', authors: [], year: currentYear, citationCount: 1000, source: 'semantic_scholar' },
    ];
    const result = scorePapers(papers, 'test');
    expect(result[0]?.title).toBe('High Cited');
  });

  it('citationCount가 undefined인 논문에 중앙값 기본값이 적용된다', () => {
    // 홀수 배열 [10, 100, 1000] → 중앙값(index 1) = 100
    const papers: PaperResult[] = [
      { title: 'No Citation', authors: [], year: currentYear, source: 'openalex' },
      { title: 'Low Cited', authors: [], year: currentYear, citationCount: 10, source: 'semantic_scholar' },
      { title: 'Mid Cited', authors: [], year: currentYear, citationCount: 100, source: 'semantic_scholar' },
      { title: 'High Cited', authors: [], year: currentYear, citationCount: 1000, source: 'semantic_scholar' },
    ];
    const result = scorePapers(papers, 'test');
    const noCitationScore = result.find((p) => p.title === 'No Citation')?.score ?? 0;
    const midCitedScore = result.find((p) => p.title === 'Mid Cited')?.score ?? 0;
    const highCitedScore = result.find((p) => p.title === 'High Cited')?.score ?? 0;
    // 중앙값(100)이 기본값이므로 No Citation ≈ Mid Cited
    expect(noCitationScore).toBeCloseTo(midCitedScore, 2);
    expect(highCitedScore).toBeGreaterThan(noCitationScore);
  });

  it('abstract에 쿼리 키워드가 많이 포함된 논문이 높은 abstractMatch를 받는다', () => {
    const papers: PaperResult[] = [
      { title: 'A', authors: [], year: currentYear, abstract: 'nothing relevant here', source: 'openalex' },
      { title: 'B', authors: [], year: currentYear, abstract: 'deep learning neural network', source: 'openalex' },
    ];
    const result = scorePapers(papers, 'deep learning');
    expect(result[0]?.title).toBe('B');
  });

  it('abstract 없는 논문은 title로 abstractMatch를 계산한다', () => {
    const papers: PaperResult[] = [
      { title: 'Unrelated Title', authors: [], year: currentYear, source: 'crossref' },
      { title: 'Deep Learning Survey', authors: [], year: currentYear, source: 'crossref' },
    ];
    const result = scorePapers(papers, 'deep learning');
    expect(result[0]?.title).toBe('Deep Learning Survey');
  });

  it('모든 논문의 citationCount가 undefined이면 citationNorm이 0.5로 균등 처리된다', () => {
    const papers: PaperResult[] = [
      { title: 'A', authors: [], year: currentYear, source: 'openalex' },
      { title: 'B', authors: [], year: currentYear, source: 'crossref' },
    ];
    const result = scorePapers(papers, 'test');
    // citationNorm이 둘 다 0.5이므로 score 차이 없음 (동점)
    expect(result[0]?.score).toBeCloseTo(result[1]?.score ?? 0, 5);
  });

  it('year가 0인 논문의 recency score는 0이다', () => {
    const papers: PaperResult[] = [
      { title: 'No Year', authors: [], year: 0, source: 'crossref' },
    ];
    const result = scorePapers(papers, 'test');
    const recencyContrib = (result[0]?.score ?? 0) - 0.5 * 0.5; // citationNorm=0.5
    expect(recencyContrib).toBeLessThanOrEqual(0.001);
  });

  it('결과가 score 내림차순으로 정렬된다', () => {
    const papers: PaperResult[] = [
      { title: 'Old Low', authors: [], year: 1990, citationCount: 1, source: 'semantic_scholar' },
      { title: 'New High', authors: [], year: currentYear, citationCount: 500, source: 'semantic_scholar' },
      { title: 'Mid', authors: [], year: 2010, citationCount: 100, source: 'semantic_scholar' },
    ];
    const result = scorePapers(papers, 'test');
    for (let i = 0; i < result.length - 1; i++) {
      expect((result[i]?.score ?? 0)).toBeGreaterThanOrEqual(result[i + 1]?.score ?? 0);
    }
  });

  it('searchAll 반환 결과에 score 필드가 포함된다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ paperId: '1', title: 'Scored Paper', authors: [], year: currentYear, externalIds: {}, citationCount: 50 }],
        total: 1, offset: 0,
      }),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], meta: { count: 0 } }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: { items: [] } }) });

    const results = await searchAll(['test'], 'test', 10);
    expect(results[0]?.score).toBeDefined();
    expect(results[0]?.score).toBeGreaterThanOrEqual(0);
    expect(results[0]?.score).toBeLessThanOrEqual(1);
  });
});

// ─── searchAll ─────────────────────────────────────────────────

describe('searchAll', () => {
  it('merges results from all three APIs and applies limit', async () => {
    // SS response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { paperId: '1', title: 'Paper SS', authors: [], year: 2020, externalIds: {} },
        ],
        total: 1, offset: 0,
      }),
    });
    // OpenAlex response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { id: 'W1', title: 'Paper OA', authorships: [], publication_year: 2021 },
        ],
        meta: { count: 1 },
      }),
    });
    // CrossRef response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { items: [{ DOI: '10.1/test', title: ['Paper CR'], 'published-print': { 'date-parts': [[2022]] } }] },
      }),
    });

    const results = await searchAll(['machine learning'], 'ML', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('returns results even if one API fails', async () => {
    // SS fails
    mockFetch.mockRejectedValueOnce(new Error('SS down'));
    // OpenAlex succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { id: 'W2', title: 'OpenAlex Only Paper', authorships: [], publication_year: 2023 },
        ],
        meta: { count: 1 },
      }),
    });
    // CrossRef fails
    mockFetch.mockRejectedValueOnce(new Error('CR down'));

    const results = await searchAll(['test topic'], 'test', 10);
    expect(results.some((r) => r.title === 'OpenAlex Only Paper')).toBe(true);
  });

  it('respects limit', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      paperId: `p${i}`,
      title: `Unique Paper ${i}`,
      authors: [],
      year: 2020,
      externalIds: {},
    }));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: items, total: 5, offset: 0 }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], meta: { count: 0 } }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: { items: [] } }) });

    const results = await searchAll(['machine learning'], 'ML', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
