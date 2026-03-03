import * as fs from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

export interface ParsedDocument {
  text: string;
  metadata: {
    title?: string;
    authors?: string[];
    year?: number;
    pageCount?: number;
    abstract?: string;
  };
  slides?: Array<{ index: number; text: string; notes?: string }>;
}

export class ReferenceParser {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async parseFile(filePath: string): Promise<ParsedDocument> {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.hwp':
      case '.hwpx':
        return this.parseHwp(filePath);
      case '.pdf':
        return this.parsePdf(filePath);
      case '.pptx':
        return this.parsePptx(filePath);
      case '.docx':
        return this.parseDocx(filePath);
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.webp':
      case '.gif':
        return this.parseImage(filePath);
      default:
        // 텍스트 파일로 시도
        return this.parsePlainText(filePath);
    }
  }

  async parseUrl(url: string): Promise<ParsedDocument> {
    // arxiv.org 특수 처리
    if (url.includes('arxiv.org')) {
      return this.parseArxiv(url);
    }

    // doi.org 특수 처리
    if (url.includes('doi.org')) {
      return this.parseDoi(url);
    }

    // 일반 URL: fetch + 본문 추출
    return this.fetchAndExtract(url);
  }

  async parseDoi(doi: string): Promise<ParsedDocument> {
    // DOI에서 순수 식별자 추출
    const doiId = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');

    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(doiId)}?fields=title,authors,year,abstract`);

    if (res.ok) {
      const data = await res.json() as {
        title?: string;
        authors?: Array<{ name: string }>;
        year?: number;
        abstract?: string;
      };
      return {
        text: data.abstract ?? '',
        metadata: {
          title: data.title,
          authors: data.authors?.map((a) => a.name),
          year: data.year,
          abstract: data.abstract,
        },
      };
    }

    return { text: '', metadata: {} };
  }

  private async parseHwp(filePath: string): Promise<ParsedDocument> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hwpMod = await import('hwp.js') as any;
      const HWPReader = hwpMod.default ?? hwpMod;
      const buffer = fs.readFileSync(filePath);
      const reader = new HWPReader();
      await reader.open(buffer);

      // hwp.js 내부 구조: document.body.sections[].content[].content[].text
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sections = reader.document?.body?.sections ?? [];
      const text = sections
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .flatMap((s: any) => s.content ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .flatMap((c: any) => c.content ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => p.text ?? '')
        .join('\n');

      return {
        text: text || `[HWP 내용 없음: ${path.basename(filePath)}]`,
        metadata: { title: path.basename(filePath, path.extname(filePath)) },
      };
    } catch (err) {
      // hwp.js 미설치 또는 파싱 오류 → graceful fallback
      return {
        text: `[HWP 파일: ${path.basename(filePath)}. 텍스트 추출 실패: ${err instanceof Error ? err.message : String(err)}. hwp.js 패키지 설치를 확인하세요.]`,
        metadata: { title: path.basename(filePath, path.extname(filePath)) },
      };
    }
  }

  private async parsePdf(filePath: string): Promise<ParsedDocument> {
    const pdfParseModule = await import('pdf-parse');
    // pdf-parse exports differently depending on module resolution
    const pdfParse = (pdfParseModule as unknown as { default?: (buf: Buffer) => Promise<{text: string; numpages: number; info?: Record<string, unknown>}> }).default
      ?? (pdfParseModule as unknown as (buf: Buffer) => Promise<{text: string; numpages: number; info?: Record<string, unknown>}>);
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer);

    // 간단한 메타데이터 추출 (첫 500자에서)
    const firstLines = result.text.slice(0, 500).split('\n');
    const title = firstLines.find((l: string) => l.trim().length > 10)?.trim();

    return {
      text: result.text,
      metadata: {
        title: (result.info?.Title as string | undefined) ?? title,
        pageCount: result.numpages,
        abstract: this.extractAbstract(result.text),
      },
    };
  }

  private async parsePptx(filePath: string): Promise<ParsedDocument> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pptx2jsonMod = await import('pptx2json' as string) as any;
      const pptx2json = pptx2jsonMod.default ?? pptx2jsonMod;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await pptx2json(filePath) as any;

      const slides: Array<{ index: number; text: string; notes?: string }> = [];
      let fullText = '';

      if (Array.isArray(data?.slides)) {
        for (let i = 0; i < data.slides.length; i++) {
          const slide = data.slides[i];
          const texts: string[] = [];

          if (Array.isArray(slide?.shapes)) {
            for (const shape of slide.shapes) {
              if (shape?.text) texts.push(String(shape.text));
            }
          }

          const slideText = texts.join('\n');
          const notes = slide?.notes ? String(slide.notes) : undefined;

          slides.push({ index: i, text: slideText, notes });
          fullText += slideText + '\n';
        }
      }

      return {
        text: fullText,
        metadata: { title: path.basename(filePath, '.pptx') },
        slides,
      };
    } catch {
      // fallback: 파일을 텍스트로 처리
      return { text: '', metadata: { title: path.basename(filePath, '.pptx') }, slides: [] };
    }
  }

  private async parseDocx(filePath: string): Promise<ParsedDocument> {
    const mammoth = await import('mammoth');
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });

    return {
      text: result.value,
      metadata: { title: path.basename(filePath, '.docx') },
    };
  }

  private async parseImage(filePath: string): Promise<ParsedDocument> {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}` as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: '이 이미지의 내용을 상세히 설명해주세요. 텍스트가 있으면 모두 추출하고, 그래프나 표는 수치와 함께 설명해주세요.',
            },
          ],
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return {
      text,
      metadata: { title: path.basename(filePath) },
    };
  }

  private async parseArxiv(url: string): Promise<ParsedDocument> {
    // arxiv ID 추출
    const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.]+)/);
    const arxivId = match?.[1];
    if (!arxivId) return this.fetchAndExtract(url);

    const apiUrl = `https://export.arxiv.org/abs/${arxivId}`;
    try {
      const res = await fetch(apiUrl);
      const html = await res.text();

      // 간단한 HTML 파싱으로 제목/초록 추출
      const titleMatch = html.match(/<h1[^>]*class="title[^"]*"[^>]*>(.*?)<\/h1>/s);
      const abstractMatch = html.match(/<blockquote[^>]*class="abstract[^"]*"[^>]*>(.*?)<\/blockquote>/s);

      const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').replace('Title:', '').trim();
      const abstract = abstractMatch?.[1]?.replace(/<[^>]+>/g, '').replace('Abstract:', '').trim();

      return {
        text: abstract ?? '',
        metadata: { title, abstract },
      };
    } catch {
      return { text: '', metadata: {} };
    }
  }

  private async fetchAndExtract(url: string): Promise<ParsedDocument> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'uni-agent/0.1.0' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();

      // 간단한 텍스트 추출 (스크립트/스타일 제거)
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50000);

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch?.[1]?.trim();

      return {
        text,
        metadata: { title },
      };
    } catch {
      return { text: '', metadata: { title: url } };
    }
  }

  private parsePlainText(filePath: string): ParsedDocument {
    const text = fs.readFileSync(filePath, 'utf-8');
    return {
      text,
      metadata: { title: path.basename(filePath) },
    };
  }

  private extractAbstract(text: string): string | undefined {
    // "Abstract" 키워드 이후 첫 단락 추출
    const match = text.match(/(?:abstract|초록|요약)\s*[:.]?\s*([\s\S]{100,1000}?)(?:\n{2,}|\d+\s+introduction)/i);
    return match?.[1]?.trim();
  }
}

export const referenceParser = new ReferenceParser();
