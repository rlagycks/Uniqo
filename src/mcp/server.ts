import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchAll } from '../tools/search.js';
import type { PaperResult } from '../types/index.js';
import { referenceStore } from '../reference/store.js';
import { formatterAgent } from '../agents/formatter.js';
import { referenceParser } from '../reference/parser.js';
import type { Draft } from '../types/index.js';

const server = new McpServer({
  name: 'uni-agent',
  version: '2.0.0',
});

// ─── search_papers ──────────────────────────────────────────────

server.tool(
  'search_papers',
  '학술 논문을 검색합니다. 반환된 결과를 바탕으로 관련성을 직접 판단하고 인용할 논문을 선택하세요.',
  {
    topic: z.string().describe('검색 주제'),
    keywords: z.array(z.string()).optional().describe('검색 키워드 (없으면 topic 사용)'),
    limit: z.number().optional().default(15).describe('최대 결과 수 (기본 15)'),
  },
  async ({ topic, keywords, limit }) => {
    const papers = await searchAll(keywords ?? [topic], topic, limit ?? 15);
    return {
      content: [{ type: 'text', text: JSON.stringify(papers, null, 2) }],
    };
  },
);

// ─── register_references ───────────────────────────────────────

server.tool(
  'register_references',
  '선택한 논문들을 레퍼런스 DB에 등록합니다. search_papers 결과 중 관련성 높은 논문만 등록하세요.',
  {
    papers: z.array(z.object({
      title: z.string(),
      authors: z.array(z.string()),
      year: z.number(),
      abstract: z.string().optional(),
      doi: z.string().optional(),
      url: z.string().optional(),
      source: z.string(),
    })).describe('등록할 논문 목록'),
  },
  async ({ papers }) => {
    const ids: string[] = [];
    for (const p of papers) {
      const entry = await referenceStore.addPaperResult(p as PaperResult);
      ids.push(`${entry.id}: ${entry.citationKey} — ${entry.title}`);
    }
    return {
      content: [{ type: 'text', text: ids.join('\n') }],
    };
  },
);

// ─── save_output ────────────────────────────────────────────────

server.tool(
  'save_output',
  'Marp PPT 마크다운 또는 보고서 마크다운을 파일로 변환·저장합니다.',
  {
    content: z.string().describe('Marp/보고서 마크다운 전체 내용'),
    output_type: z.enum(['ppt', 'report', 'notes']).describe('출력 유형'),
    title: z.string().describe('파일 제목'),
    format: z.enum(['pdf', 'docx', 'md']).optional().describe('출력 형식 (기본: ppt→pdf, report→docx, notes→md)'),
  },
  async ({ content, output_type, title }) => {
    const draft: Draft = {
      outputType: output_type,
      structure: [],
      content,
      selfReviewScore: 1.0,
      citations: [],
      title,
    };
    const output = await formatterAgent.run({ draft, outputType: output_type });
    return {
      content: [{ type: 'text', text: `저장 완료: ${output.outputPath} (${Math.round(output.sizeBytes / 1024)}KB, ${output.format})` }],
    };
  },
);

// ─── list_references ───────────────────────────────────────────

server.tool(
  'list_references',
  '등록된 참고문헌 목록을 조회합니다.',
  {
    source: z
      .enum(['semantic_scholar', 'openalex', 'crossref', 'pdf', 'pptx', 'docx', 'url', 'doi', 'image'])
      .optional()
      .describe('출처 필터'),
    year: z.number().optional().describe('출판 연도 필터'),
  },
  async ({ source, year }) => {
    const filter: Parameters<typeof referenceStore.list>[0] = {};
    if (source) filter.source = source;
    if (year !== undefined) filter.year = year;
    const entries = referenceStore.list(filter);

    if (entries.length === 0) {
      return { content: [{ type: 'text', text: '등록된 참고문헌이 없습니다.' }] };
    }

    const list = entries
      .map((e, i) => {
        const authors = e.authors.length > 0 ? e.authors.join(', ') : '저자 미상';
        return `${i + 1}. [${e.id}] ${e.title} — ${authors} (${e.year}) [${e.source}]`;
      })
      .join('\n');

    return {
      content: [{ type: 'text', text: `📚 참고문헌 목록 (${entries.length}건)\n\n${list}` }],
    };
  },
);

// ─── parse_file ─────────────────────────────────────────────────

server.tool(
  'parse_file',
  '파일(PDF/PPTX/DOCX/HWP)에서 텍스트와 메타데이터를 추출합니다.',
  {
    file_path: z.string().describe('파싱할 파일의 절대 경로'),
  },
  async ({ file_path }) => {
    const parsed = await referenceParser.parseFile(file_path);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          text: parsed.text.slice(0, 10000),
          metadata: parsed.metadata,
        }, null, 2),
      }],
    };
  },
);

// ─── 서버 시작 ─────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('uni-agent MCP server started (Thin MCP mode)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
