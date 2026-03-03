import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs to avoid actual file system operations
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
}));

vi.mock('../context/vector-store.js', () => ({
  vectorStore: {
    search: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

describe('ContextManager — computeEmbedding', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('VOYAGE_API_KEY 없으면 TF 로컬 임베딩 반환 (1536차원, L2 정규화)', async () => {
    vi.stubEnv('VOYAGE_API_KEY', '');
    const { ContextManager } = await import('./manager.js');
    const manager = new ContextManager();

    const result = await manager.embed('hello world');

    expect(result).toHaveLength(1536);
    // L2 정규화 확인: 벡터 크기 ≈ 1
    const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('VOYAGE_API_KEY 있으면 Voyage API 호출, 1024차원 반환', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-voyage-key');

    const mockEmbed = vi.fn().mockResolvedValueOnce({
      embeddings: [new Array(1024).fill(0.1)],
    });
    vi.doMock('voyageai', () => ({
      VoyageAIClient: vi.fn().mockImplementation(function () {
        return { embed: mockEmbed };
      }),
    }));

    const { ContextManager } = await import('./manager.js');
    const manager = new ContextManager();

    const result = await manager.embed('AI 윤리');

    expect(result).toHaveLength(1024);
    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'voyage-multilingual-2' }),
    );
  });

  it('Voyage API 실패 시 TF fallback (1536차원)', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-voyage-key');

    vi.doMock('voyageai', () => ({
      VoyageAIClient: vi.fn().mockImplementation(function () {
        return {
          embed: vi.fn().mockRejectedValueOnce(new Error('API error')),
        };
      }),
    }));

    const { ContextManager } = await import('./manager.js');
    const manager = new ContextManager();

    const result = await manager.embed('fallback test');

    expect(result).toHaveLength(1536);
  });
});
