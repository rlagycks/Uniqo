import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WriterInput, ResearchReport, PaperSummary } from '../types/index.js';

// vi.hoisted로 mock 함수를 팩토리 내에서도 참조 가능하게 선언
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  // class constructor를 new로 호출하므로 function 키워드 필수
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

vi.mock('../context/manager.js', () => ({
  contextManager: {
    getRelevantChunks: vi.fn().mockResolvedValue([]),
    buildRetrievedContext: vi.fn().mockReturnValue(''),
    clearWorkingChunks: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue({ sessionId: 'test', referenceLibrary: [] }),
  },
}));

vi.mock('../reference/store.js', () => ({
  referenceStore: {
    get: vi.fn().mockReturnValue(null),
    list: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../reference/citation.js', () => ({
  buildCitationRefs: vi.fn().mockReturnValue([]),
  formatInlineCitation: vi.fn().mockReturnValue('(저자, 2023)'),
}));

function makePaper(overrides: Partial<PaperSummary> = {}): PaperSummary {
  return {
    refId: 'ref_001',
    title: 'Test Paper',
    authors: ['Kim'],
    year: 2023,
    relevanceScore: 0.8,
    keyPoints: ['핵심 논점 1'],
    source: 'semantic_scholar',
    ...overrides,
  };
}

function makeResearchReport(papers: PaperSummary[] = [makePaper()]): ResearchReport {
  return {
    papers,
    confidence: 0.8,
    gaps: [],
    searchKeywords: ['test'],
    totalFound: 1,
    iterationCount: 1,
  };
}

function mockTextResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

describe('WriterAgent — designStructure slideCount 반영', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('preferences.slideCount=12이면 프롬프트에 "정확히 12개 섹션" 지시가 포함된다', async () => {
    // extractKeyPoints
    mockCreate.mockResolvedValueOnce(mockTextResponse('["논점1", "논점2"]'));
    // designStructure — 12개 섹션 반환
    mockCreate.mockResolvedValueOnce(
      mockTextResponse(
        '["표지","목차","서론","배경1","배경2","본론1","본론2","본론3","사례","비교","결론","참고문헌"]',
      ),
    );
    // writeSections (12회)
    for (let i = 0; i < 12; i++) {
      mockCreate.mockResolvedValueOnce(mockTextResponse('섹션 내용'));
    }
    // selfReview
    mockCreate.mockResolvedValueOnce(mockTextResponse('{ "score": 0.9, "suggestions": [] }'));

    const { WriterAgent } = await import('./writer.js');
    const agent = new WriterAgent();

    const input: WriterInput = {
      researchReport: makeResearchReport(),
      outputType: 'ppt',
      intent: '딥러닝 발표',
      sessionId: 'sess-1',
      preferences: { slideCount: 12 },
    };

    const draft = await agent.run(input);

    // 두 번째 LLM 호출이 designStructure
    const designCall = mockCreate.mock.calls[1];
    const prompt = designCall?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain('12');
    expect(draft.structure.length).toBe(12);
  });

  it('preferences.style="academic"이면 프롬프트에 논문체 지시가 포함된다', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('["논점1"]'));
    mockCreate.mockResolvedValueOnce(mockTextResponse('["서론","본론","결론"]'));
    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce(mockTextResponse('내용'));
    }
    mockCreate.mockResolvedValueOnce(mockTextResponse('{ "score": 0.8, "suggestions": [] }'));

    const { WriterAgent } = await import('./writer.js');
    const agent = new WriterAgent();

    const input: WriterInput = {
      researchReport: makeResearchReport(),
      outputType: 'report',
      intent: 'AI 윤리 보고서',
      sessionId: 'sess-2',
      preferences: { style: 'academic' },
    };

    await agent.run(input);

    const designCall = mockCreate.mock.calls[1];
    const prompt = designCall?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain('논문체');
  });

  it('preferences.style="minimal"이면 프롬프트에 핵심 포인트 간결 지시가 포함된다', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('[]'));
    mockCreate.mockResolvedValueOnce(mockTextResponse('["개요","핵심","마무리"]'));
    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce(mockTextResponse('내용'));
    }
    mockCreate.mockResolvedValueOnce(mockTextResponse('{ "score": 0.8, "suggestions": [] }'));

    const { WriterAgent } = await import('./writer.js');
    const agent = new WriterAgent();

    const input: WriterInput = {
      researchReport: makeResearchReport(),
      outputType: 'notes',
      intent: '강의 노트',
      sessionId: 'sess-3',
      preferences: { style: 'minimal' },
    };

    await agent.run(input);

    const designCall = mockCreate.mock.calls[1];
    const prompt = designCall?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain('간결');
  });

  it('preferences 없으면 "5~10개 사이" 기본 지시가 적용된다', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('[]'));
    mockCreate.mockResolvedValueOnce(mockTextResponse('["서론","본론","결론"]'));
    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce(mockTextResponse('내용'));
    }
    mockCreate.mockResolvedValueOnce(mockTextResponse('{ "score": 0.8, "suggestions": [] }'));

    const { WriterAgent } = await import('./writer.js');
    const agent = new WriterAgent();

    const input: WriterInput = {
      researchReport: makeResearchReport(),
      outputType: 'ppt',
      intent: '발표 자료',
      sessionId: 'sess-4',
    };

    await agent.run(input);

    const designCall = mockCreate.mock.calls[1];
    const prompt = designCall?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain('5~10개');
  });
});
