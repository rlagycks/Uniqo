import { v4 as uuidv4 } from 'uuid';
import type { Chunk, ChunkMetadata } from '../types/index.js';

const CHUNK_TOKEN_SIZE = 512;
const OVERLAP_TOKEN_SIZE = 50;
// Rough approximation: 1 token ≈ 4 characters
const CHARS_PER_TOKEN = 4;

const CHUNK_SIZE = CHUNK_TOKEN_SIZE * CHARS_PER_TOKEN;     // 2048 chars
const OVERLAP_SIZE = OVERLAP_TOKEN_SIZE * CHARS_PER_TOKEN;  // 200 chars

export interface RawChunk {
  text: string;
  metadata: Omit<ChunkMetadata, 'chunkIndex' | 'totalChunks'>;
}

/**
 * PDF 본문 텍스트를 512 토큰 / 50 토큰 오버랩으로 청킹
 * 단락(\n\n) 경계를 우선 존중한다.
 */
export function chunkPdfText(
  refId: string,
  fullText: string,
  abstract?: string,
): Chunk[] {
  const rawChunks: RawChunk[] = [];

  // Abstract는 단일 청크 (분할 금지)
  if (abstract && abstract.trim()) {
    rawChunks.push({
      text: abstract.trim(),
      metadata: { isAbstract: true },
    });
  }

  // 본문을 단락 기준으로 분할
  const body = fullText.replace(abstract ?? '', '').trim();
  const paragraphs = body.split(/\n{2,}/);

  let buffer = '';
  let pageNumber = 1;

  for (const para of paragraphs) {
    if (!para.trim()) continue;

    // 페이지 번호 추정 (단순 휴리스틱)
    if (para.includes('\f')) pageNumber++;

    if ((buffer + '\n\n' + para).length <= CHUNK_SIZE) {
      buffer = buffer ? buffer + '\n\n' + para : para;
    } else {
      if (buffer) {
        rawChunks.push({ text: buffer.trim(), metadata: { pageNumber } });
      }
      // 오버랩: 이전 청크의 끝 부분을 포함
      const overlap = buffer.slice(-OVERLAP_SIZE);
      buffer = overlap ? overlap + '\n\n' + para : para;
    }
  }

  if (buffer.trim()) {
    rawChunks.push({ text: buffer.trim(), metadata: { pageNumber } });
  }

  return assignChunkIds(refId, rawChunks);
}

/**
 * PPT 슬라이드 배열: 1슬라이드 = 1청크 (발표자 노트 포함)
 */
export function chunkPptSlides(
  refId: string,
  slides: Array<{ index: number; text: string; notes?: string }>,
): Chunk[] {
  const rawChunks: RawChunk[] = slides.map((slide) => {
    const text = [slide.text, slide.notes ? `[발표자 노트] ${slide.notes}` : '']
      .filter(Boolean)
      .join('\n');
    return {
      text: text.trim(),
      metadata: { slideIndex: slide.index },
    };
  });
  return assignChunkIds(refId, rawChunks);
}

/**
 * 보고서 텍스트: 섹션 제목(#, ##) 기준 분할
 */
export function chunkReportText(refId: string, text: string): Chunk[] {
  // 마크다운 제목 패턴으로 분할
  const sectionPattern = /(?=^#{1,3} .+)/m;
  const sections = text.split(sectionPattern).filter((s) => s.trim());

  const rawChunks: RawChunk[] = [];

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const titleLine = lines[0] ?? '';
    const sectionTitle = titleLine.replace(/^#+\s*/, '');

    if (section.length <= CHUNK_SIZE) {
      rawChunks.push({ text: section.trim(), metadata: { section: sectionTitle } });
    } else {
      // 섹션이 너무 길면 추가로 분할
      const subChunks = splitBySize(section, CHUNK_SIZE, OVERLAP_SIZE);
      for (const sc of subChunks) {
        rawChunks.push({ text: sc.trim(), metadata: { section: sectionTitle } });
      }
    }
  }

  return assignChunkIds(refId, rawChunks);
}

/**
 * 일반 텍스트 청킹 (URL 본문, 이미지 설명 등)
 */
export function chunkGenericText(refId: string, text: string): Chunk[] {
  const parts = splitBySize(text, CHUNK_SIZE, OVERLAP_SIZE);
  const rawChunks: RawChunk[] = parts.map((p) => ({ text: p.trim(), metadata: {} }));
  return assignChunkIds(refId, rawChunks);
}

function assignChunkIds(refId: string, rawChunks: RawChunk[]): Chunk[] {
  const total = rawChunks.length;
  return rawChunks.map((rc, i) => ({
    id: uuidv4(),
    refId,
    text: rc.text,
    embedding: [],  // 임베딩은 VectorStore.add() 시점에 계산
    metadata: {
      ...rc.metadata,
      chunkIndex: i,
      totalChunks: total,
    },
  }));
}

function splitBySize(text: string, chunkSize: number, overlapSize: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlapSize;
  }

  return chunks;
}
