import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchAll } from '../tools/search.js';
import type { PaperResult, OutputType } from '../types/index.js';
import { referenceStore } from '../reference/store.js';
import { formatterAgent } from '../agents/formatter.js';
import { referenceParser } from '../reference/parser.js';
import type { Draft } from '../types/index.js';
import { wrapTool } from './hook.js';
import { contextInjector } from './context-injector.js';
import { stateManager } from './state.js';
import { validateCitationKeys } from './citation-validator.js';

const server = new McpServer({
  name: 'uni-agent',
  version: '3.0.0',
});

// ─── plan_task ───────────────────────────────────────────────────

const MILESTONE_MAP: Record<string, string[]> = {
  ppt: ['search_papers', 'register_references', '콘텐츠 작성 (Marp)', 'save_output'],
  report: ['search_papers', 'register_references', '콘텐츠 작성 (보고서)', 'save_output'],
  notes: ['parse_file 또는 search_papers', '콘텐츠 작성 (노트)', 'save_output'],
  research_only: ['search_papers', 'register_references', '결과 정리'],
};

server.tool(
  'plan_task',
  '작업 목표를 설정하고 마일스톤을 계획합니다. 새 작업 시작 시 가장 먼저 호출하세요.',
  {
    goal: z.string().describe('달성할 목표 (예: "AI 윤리 발표 12장 만들기")'),
    output_type: z
      .enum(['ppt', 'report', 'notes', 'research_only'])
      .optional()
      .describe('출력 유형'),
    slide_count: z
      .number()
      .optional()
      .describe('PPT 슬라이드 수 (output_type이 ppt일 때)'),
  },
  wrapTool('plan_task', async ({ goal, output_type, slide_count }) => {
    const type = output_type ?? 'ppt';
    const steps = MILESTONE_MAP[type] ?? MILESTONE_MAP['ppt'] ?? [];
    const slideNote =
      type === 'ppt' && slide_count ? ` (${slide_count}장)` : '';

    const stepList = steps
      .map((s, i) => `  ${i + 1}. ${s}`)
      .join('\n');

    const plan =
      `📋 작업 계획\n` +
      `목표: ${goal}${slideNote}\n` +
      `출력 유형: ${type}\n\n` +
      `마일스톤:\n${stepList}\n\n` +
      `다음 단계: search_papers 를 호출해 관련 논문을 검색하세요.`;

    return { content: [{ type: 'text', text: plan }] };
  }),
);

// ─── search_papers ──────────────────────────────────────────────

server.tool(
  'search_papers',
  '학술 논문을 검색합니다. 반환된 결과를 바탕으로 관련성을 직접 판단하고 인용할 논문을 선택하세요.',
  {
    topic: z.string().describe('검색 주제'),
    keywords: z.array(z.string()).optional().describe('검색 키워드 (없으면 topic 사용)'),
    limit: z.number().optional().default(15).describe('최대 결과 수 (기본 15)'),
  },
  wrapTool('search_papers', async ({ topic, keywords, limit }) => {
    const papers = await searchAll(keywords ?? [topic], topic, limit ?? 15);
    return {
      content: [{ type: 'text', text: JSON.stringify(papers, null, 2) }],
    };
  }),
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
  wrapTool('register_references', async ({ papers }) => {
    const ids: string[] = [];
    for (const p of papers) {
      const entry = await referenceStore.addPaperResult(p as PaperResult);
      ids.push(`${entry.id}: ${entry.citationKey} — ${entry.title}`);
    }
    return {
      content: [{ type: 'text', text: ids.join('\n') }],
    };
  }),
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
  wrapTool('save_output', async ({ content, output_type, title }) => {
    // 인용키 검증: 미등록 키가 있으면 저장 차단
    const validation = validateCitationKeys(content, referenceStore.getCitationKeys());
    if (!validation.valid) {
      return {
        content: [{
          type: 'text',
          text: `인용키 검증 실패: 미등록 인용키 발견 [${validation.unregistered.join(', ')}]\n→ register_references로 먼저 등록하세요.`,
        }],
        isError: true,
      };
    }

    const draft: Draft = {
      outputType: output_type as OutputType,
      structure: [],
      content,
      selfReviewScore: 1.0,
      citations: [],
      title,
    };
    const output = await formatterAgent.run({ draft, outputType: output_type as OutputType });
    return {
      content: [{
        type: 'text',
        text: `저장 완료: ${output.outputPath} (${Math.round(output.sizeBytes / 1024)}KB, ${output.format})`,
      }],
    };
  }),
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
  wrapTool('list_references', async ({ source, year }) => {
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
  }),
);

// ─── parse_file ─────────────────────────────────────────────────

server.tool(
  'parse_file',
  '파일(PDF/PPTX/DOCX/HWP)에서 텍스트와 메타데이터를 추출합니다.',
  {
    file_path: z.string().describe('파싱할 파일의 절대 경로'),
  },
  wrapTool('parse_file', async ({ file_path }) => {
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
  }),
);

// ─── MCP Prompts (slash commands) ──────────────────────────────

server.prompt(
  'ppt',
  'Make a presentation: plan → search papers → register → write Marp → save PDF',
  { topic: z.string().describe('Presentation topic') },
  ({ topic }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Create a presentation on "${topic}".\n1. Call plan_task to set the goal\n2. Use search_papers to find relevant papers\n3. Select 5-8 papers and register with register_references\n4. Write 12-slide Marp markdown\n5. Save with save_output (type: ppt)`,
      },
    }],
  }),
);

server.prompt(
  'report',
  'Write a report: plan → search papers → register → write → save DOCX',
  { topic: z.string().describe('Report topic') },
  ({ topic }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Write an academic report on "${topic}".\n1. Call plan_task to set the goal\n2. Use search_papers to find relevant papers\n3. Select 5-8 papers and register with register_references\n4. Write full report markdown (intro, body, conclusion, references)\n5. Save with save_output (type: report)`,
      },
    }],
  }),
);

server.prompt(
  'search',
  'Search academic papers and summarize results',
  { topic: z.string().describe('Search topic or keywords') },
  ({ topic }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Use search_papers to find papers on "${topic}" and summarize the key results.`,
      },
    }],
  }),
);

server.prompt(
  'notes',
  'Make study notes from a topic or file path',
  { topic: z.string().describe('Topic or absolute file path') },
  ({ topic }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Create study notes on "${topic}".\nIf it looks like a file path, use parse_file first. Otherwise use search_papers to gather material.\nOrganize key concepts clearly, then save with save_output (type: notes).`,
      },
    }],
  }),
);

server.prompt(
  'refs',
  'List all registered references',
  () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: 'Use list_references to show all registered references.',
      },
    }],
  }),
);

// ─── 서버 시작 ─────────────────────────────────────────────────

async function main() {
  contextInjector.init();
  stateManager.load();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('uni-agent MCP server started (Fat MCP v3.0.0)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
