import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLlm = vi.fn();

vi.mock('../reference/store.js', () => ({
  referenceStore: {
    addFromApiResult: vi.fn().mockImplementation(
      async (paper: {
        title: string | string[];
        publication_year?: number;
        year?: number;
        authorships?: Array<{ author: { display_name: string } }>;
        authors?: Array<{ name: string }>;
        doi?: string;
        externalIds?: { DOI?: string };
      }) => ({
        id: `ref_${Math.random().toString(36).slice(2, 6)}`,
        title: Array.isArray(paper.title) ? paper.title[0] : paper.title,
        authors: paper.authorships
          ? paper.authorships.map((a) => a.author.display_name)
          : (paper.authors ?? []).map((a) => a.name),
        year: paper.publication_year ?? paper.year ?? 2023,
        doi: paper.doi ?? paper.externalIds?.DOI,
        citationKey: 'test2023',
      }),
    ),
  },
}));

// ResearchAgent의 private 메서드를 타입 단언으로 꺼내는 헬퍼 타입
type ExtractKeyPointsBatch = (
  papers: Array<{ title: string; abstract?: string }>,
) => Promise<string[][]>;

describe('ResearchAgent — extractKeyPointsBatch', () => {
  beforeEach(() => {
    mockLlm.mockReset();
  });

  it('LLM이 올바른 JSON 배열을 반환하면 keyPoints로 사용된다', async () => {
    mockLlm.mockResolvedValueOnce('[["딥러닝의 기본 원리","레이어 구조","역전파 알고리즘"]]');

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    const batch = (agent as unknown as { extractKeyPointsBatch: ExtractKeyPointsBatch })
      .extractKeyPointsBatch;

    const result = await batch.call(agent, [
      { title: 'Deep Learning Overview', abstract: 'This paper covers deep learning basics.' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(['딥러닝의 기본 원리', '레이어 구조', '역전파 알고리즘']);
  });

  it('LLM이 잘못된 JSON을 반환하면 abstract 자르기로 fallback된다', async () => {
    mockLlm.mockResolvedValueOnce('올바르지 않은 JSON');

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    const batch = (agent as unknown as { extractKeyPointsBatch: ExtractKeyPointsBatch })
      .extractKeyPointsBatch;

    const result = await batch.call(agent, [
      { title: 'Test Paper', abstract: 'A'.repeat(300) },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]![0]!.length).toBeLessThanOrEqual(200);
  });

  it('abstract가 없는 논문은 빈 배열을 fallback으로 반환한다', async () => {
    mockLlm.mockResolvedValueOnce('이것은 배열이 아님');

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    const batch = (agent as unknown as { extractKeyPointsBatch: ExtractKeyPointsBatch })
      .extractKeyPointsBatch;

    const result = await batch.call(agent, [{ title: 'No Abstract Paper' }]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([]);
  });

  it('3개 초과 시 배치를 나눠 처리한다', async () => {
    // 배치 1 (3개 논문)
    mockLlm.mockResolvedValueOnce(
      '[["논점A1","논점A2","논점A3"],["논점B1","논점B2","논점B3"],["논점C1","논점C2","논점C3"]]',
    );
    // 배치 2 (1개 논문)
    mockLlm.mockResolvedValueOnce('[["논점D1","논점D2","논점D3"]]');

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    const batch = (agent as unknown as { extractKeyPointsBatch: ExtractKeyPointsBatch })
      .extractKeyPointsBatch;

    const papers = [
      { title: 'Paper A', abstract: 'abstract A' },
      { title: 'Paper B', abstract: 'abstract B' },
      { title: 'Paper C', abstract: 'abstract C' },
      { title: 'Paper D', abstract: 'abstract D' },
    ];

    const result = await batch.call(agent, papers);

    expect(result).toHaveLength(4);
    expect(mockLlm).toHaveBeenCalledTimes(2);
    expect(result[0]).toEqual(['논점A1', '논점A2', '논점A3']);
    expect(result[3]).toEqual(['논점D1', '논점D2', '논점D3']);
  });
});

describe('ResearchAgent — searchOpenAlex', () => {
  beforeEach(() => {
    mockLlm.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fetch 성공 시 results 배열 반환', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'https://openalex.org/W001',
            title: 'AI 윤리 연구',
            authorships: [{ author: { display_name: '김철수' } }],
            publication_year: 2024,
            abstract_inverted_index: { AI: [0], 윤리: [1] },
            language: 'ko',
          },
        ],
        meta: { count: 1 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    type SearchOpenAlex = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchOpenAlex: SearchOpenAlex }).searchOpenAlex(['AI 윤리']);

    expect(result).toHaveLength(1);
    expect((result[0] as { title: string }).title).toBe('AI 윤리 연구');
  });

  it('fetch 실패 시 빈 배열 반환', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    type SearchOpenAlex = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchOpenAlex: SearchOpenAlex }).searchOpenAlex(['AI']);
    expect(result).toEqual([]);
  });

  it('빈 키워드면 빈 배열 반환', async () => {
    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    type SearchOpenAlex = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchOpenAlex: SearchOpenAlex }).searchOpenAlex([]);
    expect(result).toEqual([]);
  });
});

describe('ResearchAgent — searchCrossRef', () => {
  beforeEach(() => {
    mockLlm.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fetch 성공 시 items 배열 반환', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: '10.1234/test',
              title: ['AI Ethics Overview'],
              author: [{ family: 'Smith', given: 'John' }],
              'published-print': { 'date-parts': [[2024]] },
              abstract: 'A comprehensive overview of AI ethics',
            },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    type SearchCrossRef = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchCrossRef: SearchCrossRef }).searchCrossRef(['AI ethics']);

    expect(result).toHaveLength(1);
    expect((result[0] as { DOI: string }).DOI).toBe('10.1234/test');
  });

  it('fetch 실패 시 빈 배열 반환', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    type SearchCrossRef = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchCrossRef: SearchCrossRef }).searchCrossRef(['AI ethics']);
    expect(result).toEqual([]);
  });

  it('한국어 키워드만 있으면 빈 배열 반환 (영어 필터)', async () => {
    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent(mockLlm);
    type SearchCrossRef = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchCrossRef: SearchCrossRef }).searchCrossRef(['인공지능 윤리']);
    expect(result).toEqual([]);
  });
});
