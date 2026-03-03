import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

// Mock Anthropic to prevent real API calls
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: vi.fn() } };
  }),
}));

// Mock fs.readFileSync for HWP tests
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

describe('ReferenceParser — parseHwp', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('hwp.js 정상 동작 시 텍스트 추출', async () => {
    const mockReader = {
      open: vi.fn().mockResolvedValue(undefined),
      document: {
        body: {
          sections: [
            {
              content: [
                {
                  content: [
                    { text: '안녕하세요' },
                    { text: '한글 문서입니다' },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

    vi.doMock('hwp.js', () => ({
      // function 키워드 필수 — 화살표 함수는 new 호출 불가
      default: vi.fn().mockImplementation(function () { return mockReader; }),
    }));

    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake hwp data'));

    const { ReferenceParser } = await import('./parser.js');
    const parser = new ReferenceParser();

    const result = await (parser as unknown as { parseFile(f: string): Promise<unknown> }).parseFile('/tmp/test.hwp');
    const doc = result as { text: string; metadata: { title?: string } };

    expect(doc.text).toContain('안녕하세요');
    expect(doc.text).toContain('한글 문서입니다');
    expect(doc.metadata.title).toBe('test');
  });

  it('hwp.js import 실패 시 fallback 텍스트 반환', async () => {
    vi.doMock('hwp.js', () => {
      throw new Error('Cannot find module');
    });

    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake hwp data'));

    const { ReferenceParser } = await import('./parser.js');
    const parser = new ReferenceParser();

    const result = await (parser as unknown as { parseFile(f: string): Promise<unknown> }).parseFile('/tmp/문서.hwp');
    const doc = result as { text: string; metadata: { title?: string } };

    expect(doc.text).toContain('[HWP 파일:');
    expect(doc.text).toContain('텍스트 추출 실패');
    expect(doc.metadata.title).toBe('문서');
  });

  it('.hwpx도 동일한 parseHwp 경로 처리', async () => {
    const mockReader = {
      open: vi.fn().mockResolvedValue(undefined),
      document: {
        body: {
          sections: [
            {
              content: [
                {
                  content: [{ text: 'HWPX 내용' }],
                },
              ],
            },
          ],
        },
      },
    };

    vi.doMock('hwp.js', () => ({
      // function 키워드 필수 — 화살표 함수는 new 호출 불가
      default: vi.fn().mockImplementation(function () { return mockReader; }),
    }));

    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake hwpx data'));

    const { ReferenceParser } = await import('./parser.js');
    const parser = new ReferenceParser();

    const result = await (parser as unknown as { parseFile(f: string): Promise<unknown> }).parseFile('/tmp/report.hwpx');
    const doc = result as { text: string; metadata: { title?: string } };

    expect(doc.text).toContain('HWPX 내용');
    expect(doc.metadata.title).toBe('report');
  });
});
