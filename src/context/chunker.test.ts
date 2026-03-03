import { describe, it, expect } from 'vitest';
import {
  chunkPdfText,
  chunkPptSlides,
  chunkReportText,
  chunkGenericText,
} from './chunker.js';

describe('chunkPdfText', () => {
  it('abstract를 단일 청크로 처리한다', () => {
    const abstract = 'This is an abstract about AI ethics.';
    const body = 'Introduction\n\n' + 'Some body text. '.repeat(10);
    const chunks = chunkPdfText('ref_001', body, abstract);

    const abstractChunk = chunks.find((c) => c.metadata.isAbstract);
    expect(abstractChunk).toBeDefined();
    expect(abstractChunk?.text).toBe(abstract);
    expect(abstractChunk?.metadata.isAbstract).toBe(true);
  });

  it('refId를 각 청크에 올바르게 할당한다', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const chunks = chunkPdfText('ref_042', text);

    for (const chunk of chunks) {
      expect(chunk.refId).toBe('ref_042');
    }
  });

  it('청크에 고유 id를 부여한다', () => {
    const text = 'Para one.\n\nPara two.\n\nPara three.';
    const chunks = chunkPdfText('ref_001', text);
    const ids = chunks.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('chunkIndex와 totalChunks를 올바르게 설정한다', () => {
    // 단락 구분자(\n\n)로 여러 단락 강제 생성
    const paragraph = 'A'.repeat(2500);
    const text = [paragraph, paragraph, paragraph, paragraph, paragraph].join('\n\n');
    const chunks = chunkPdfText('ref_001', text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.metadata.chunkIndex).toBe(i);
      expect(c.metadata.totalChunks).toBe(chunks.length);
    });
  });

  it('빈 텍스트는 청크를 생성하지 않는다', () => {
    const chunks = chunkPdfText('ref_001', '');
    expect(chunks.length).toBe(0);
  });
});

describe('chunkPptSlides', () => {
  it('슬라이드 1개 = 청크 1개', () => {
    const slides = [
      { index: 0, text: 'AI란 무엇인가?', notes: '인공지능의 정의' },
      { index: 1, text: '머신러닝', notes: undefined },
      { index: 2, text: '딥러닝', notes: '신경망 기반' },
    ];
    const chunks = chunkPptSlides('ref_002', slides);
    expect(chunks.length).toBe(3);
  });

  it('발표자 노트를 텍스트에 포함한다', () => {
    const slides = [{ index: 0, text: 'Title', notes: 'Speaker note here' }];
    const chunks = chunkPptSlides('ref_002', slides);
    expect(chunks[0]?.text).toContain('Speaker note here');
    expect(chunks[0]?.text).toContain('[발표자 노트]');
  });

  it('slideIndex를 메타데이터에 저장한다', () => {
    const slides = [
      { index: 5, text: 'Slide 5' },
      { index: 6, text: 'Slide 6' },
    ];
    const chunks = chunkPptSlides('ref_002', slides);
    expect(chunks[0]?.metadata.slideIndex).toBe(5);
    expect(chunks[1]?.metadata.slideIndex).toBe(6);
  });
});

describe('chunkReportText', () => {
  it('마크다운 제목 기준으로 분할한다', () => {
    const text = `# 서론\n\n서론 내용.\n\n## 본론\n\n본론 내용.\n\n## 결론\n\n결론 내용.`;
    const chunks = chunkReportText('ref_003', text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('섹션 제목을 메타데이터에 저장한다', () => {
    const text = `# 서론\n\n서론 내용입니다.\n\n## 본론\n\n본론 내용입니다.`;
    const chunks = chunkReportText('ref_003', text);
    const sectionTitles = chunks.map((c) => c.metadata.section).filter(Boolean);
    expect(sectionTitles.length).toBeGreaterThan(0);
  });
});

describe('chunkGenericText', () => {
  it('짧은 텍스트는 단일 청크', () => {
    const chunks = chunkGenericText('ref_004', '짧은 텍스트');
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.text).toBe('짧은 텍스트');
  });

  it('긴 텍스트는 여러 청크로 분할', () => {
    const text = 'word '.repeat(2000);
    const chunks = chunkGenericText('ref_004', text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('모든 청크가 비어있지 않다', () => {
    const text = 'A'.repeat(5000);
    const chunks = chunkGenericText('ref_004', text);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });
});
