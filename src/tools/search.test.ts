import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchSemanticScholar,
  searchOpenAlex,
  searchCrossRef,
  deduplicatePapers,
  searchAll,
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
