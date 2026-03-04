import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('ContextManager — computeEmbedding', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('@xenova/transformers pipeline 성공 시 768차원 임베딩 반환', async () => {
    const fakeVector = new Float32Array(768).fill(0.1);
    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: fakeVector }),
      ),
    }));

    const { ContextManager } = await import('./manager.js');
    const manager = new ContextManager();

    const result = await manager.embed('hello world');

    expect(result).toHaveLength(768);
  });

  it('@xenova/transformers 실패 시 fallback 768차원 벡터 반환 (L2 정규화)', async () => {
    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockRejectedValue(new Error('model load failed')),
    }));

    const { ContextManager } = await import('./manager.js');
    const manager = new ContextManager();

    const result = await manager.embed('fallback test');

    expect(result).toHaveLength(768);
    // L2 정규화 확인: 벡터 크기 ≈ 1
    const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('getEmbeddingDimension()은 항상 768을 반환한다', async () => {
    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(vi.fn()),
    }));

    const { ContextManager } = await import('./manager.js');
    const manager = new ContextManager();

    expect(manager.getEmbeddingDimension()).toBe(768);
  });

  it('같은 텍스트는 캐시에서 반환된다', async () => {
    const fakeVector = new Float32Array(768).fill(0.2);
    const mockEmbedder = vi.fn().mockResolvedValue({ data: fakeVector });
    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(mockEmbedder),
    }));

    const { ContextManager } = await import('./manager.js');
    const manager = new ContextManager();

    await manager.embed('cached text');
    await manager.embed('cached text');

    // pipeline embedder가 한 번만 호출되어야 함 (두 번째는 캐시에서)
    expect(mockEmbedder).toHaveBeenCalledTimes(1);
  });
});
