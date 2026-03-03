import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  // class constructor를 new로 호출하므로 function 키워드 필수
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

vi.mock('../reference/store.js', () => ({
  referenceStore: {
    addFromApiResult: vi.fn().mockImplementation(
      async (paper: {
        title: string;
        year?: number;
        authors?: Array<{ name: string }>;
        externalIds?: { DOI?: string };
      }) => ({
        id: `ref_${Math.random().toString(36).slice(2, 6)}`,
        title: paper.title,
        authors: (paper.authors ?? []).map((a) => a.name),
        year: paper.year ?? 2023,
        doi: paper.externalIds?.DOI,
        citationKey: 'test2023',
      }),
    ),
  },
}));

function mockTextResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

// ResearchAgent의 private 메서드를 타입 단언으로 꺼내는 헬퍼 타입
type ExtractKeyPointsBatch = (
  papers: Array<{ title: string; abstract?: string }>,
) => Promise<string[][]>;

describe('ResearchAgent — extractKeyPointsBatch', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('LLM이 올바른 JSON 배열을 반환하면 keyPoints로 사용된다', async () => {
    mockCreate.mockResolvedValueOnce(
      mockTextResponse('[["딥러닝의 기본 원리","레이어 구조","역전파 알고리즘"]]'),
    );

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    const batch = (agent as unknown as { extractKeyPointsBatch: ExtractKeyPointsBatch })
      .extractKeyPointsBatch;

    const result = await batch.call(agent, [
      { title: 'Deep Learning Overview', abstract: 'This paper covers deep learning basics.' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(['딥러닝의 기본 원리', '레이어 구조', '역전파 알고리즘']);
  });

  it('LLM이 잘못된 JSON을 반환하면 abstract 자르기로 fallback된다', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('올바르지 않은 JSON'));

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    const batch = (agent as unknown as { extractKeyPointsBatch: ExtractKeyPointsBatch })
      .extractKeyPointsBatch;

    const result = await batch.call(agent, [
      { title: 'Test Paper', abstract: 'A'.repeat(300) },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]![0]!.length).toBeLessThanOrEqual(200);
  });

  it('abstract가 없는 논문은 빈 배열을 fallback으로 반환한다', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('이것은 배열이 아님'));

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    const batch = (agent as unknown as { extractKeyPointsBatch: ExtractKeyPointsBatch })
      .extractKeyPointsBatch;

    const result = await batch.call(agent, [{ title: 'No Abstract Paper' }]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([]);
  });

  it('3개 초과 시 배치를 나눠 처리한다', async () => {
    // 배치 1 (3개 논문)
    mockCreate.mockResolvedValueOnce(
      mockTextResponse(
        '[["논점A1","논점A2","논점A3"],["논점B1","논점B2","논점B3"],["논점C1","논점C2","논점C3"]]',
      ),
    );
    // 배치 2 (1개 논문)
    mockCreate.mockResolvedValueOnce(
      mockTextResponse('[["논점D1","논점D2","논점D3"]]'),
    );

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
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
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result[0]).toEqual(['논점A1', '논점A2', '논점A3']);
    expect(result[3]).toEqual(['논점D1', '논점D2', '논점D3']);
  });
});

describe('ResearchAgent — searchDbpia', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('DBPIA_API_KEY 없으면 빈 배열 반환', async () => {
    vi.stubEnv('DBPIA_API_KEY', '');
    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    type SearchDbpia = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchDbpia: SearchDbpia }).searchDbpia(['AI ethics']);
    expect(result).toEqual([]);
  });

  it('fetch 성공 시 content 배열 반환', async () => {
    vi.stubEnv('DBPIA_API_KEY', 'test-key');
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalCount: 1,
        content: [
          {
            publicationId: 'P001',
            title: 'AI 윤리 연구',
            author: '김철수',
            publishYear: '2024',
            journalName: '한국AI학회지',
            abstract: '인공지능 윤리에 관한 연구',
            url: 'https://www.dbpia.co.kr/P001',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    type SearchDbpia = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchDbpia: SearchDbpia }).searchDbpia(['AI 윤리']);

    expect(result).toHaveLength(1);
    expect((result[0] as { title: string }).title).toBe('AI 윤리 연구');
  });

  it('fetch 실패 시 빈 배열 반환', async () => {
    vi.stubEnv('DBPIA_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    type SearchDbpia = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchDbpia: SearchDbpia }).searchDbpia(['AI']);
    expect(result).toEqual([]);
  });
});

describe('ResearchAgent — searchTavily', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('TAVILY_API_KEY 없으면 빈 배열 반환', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    type SearchTavily = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchTavily: SearchTavily }).searchTavily(['AI']);
    expect(result).toEqual([]);
  });

  it('fetch 성공 시 results 배열 반환 및 POST method 사용', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-key');
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'AI Ethics Overview',
            url: 'https://example.com/ai-ethics',
            content: 'A comprehensive overview of AI ethics',
            score: 0.95,
            published_date: '2024-01-15',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    type SearchTavily = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchTavily: SearchTavily }).searchTavily(['AI ethics']);

    expect(result).toHaveLength(1);
    expect((result[0] as { title: string }).title).toBe('AI Ethics Overview');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fetch 실패 시 빈 배열 반환', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));

    const { ResearchAgent } = await import('./research.js');
    const agent = new ResearchAgent();
    type SearchTavily = (keywords: string[]) => Promise<unknown[]>;
    const result = await (agent as unknown as { searchTavily: SearchTavily }).searchTavily(['AI']);
    expect(result).toEqual([]);
  });
});
