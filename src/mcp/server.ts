import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { createSamplingCaller } from './sampling.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';
import { referenceStore } from '../reference/store.js';
import { checkpointManager } from '../workflow/checkpoint.js';

const server = new McpServer({
  name: 'uni-agent',
  version: '2.0.0',
});

// ─── run_task ──────────────────────────────────────────────────

server.tool(
  'run_task',
  '학업 과제를 자동으로 처리합니다. PPT 발표자료, 보고서, 노트 등을 생성합니다.',
  {
    intent: z.string().describe('처리할 작업 내용 (예: "AI 윤리 발표 12장 만들어줘")'),
    session_id: z
      .string()
      .optional()
      .describe('세션 ID (없으면 자동 생성)'),
    attachments: z
      .array(z.string())
      .optional()
      .describe('참고할 파일 경로 목록 (PDF, PPTX, DOCX 등)'),
    preferences: z
      .object({
        slide_count: z.number().optional().describe('PPT 슬라이드 수 (예: 12)'),
        style: z.enum(['minimal', 'detailed', 'academic']).optional().describe('작성 스타일'),
        template: z.string().optional().describe('템플릿 이름'),
        output_format: z.enum(['pdf', 'docx', 'md']).optional().describe('출력 형식'),
      })
      .optional()
      .describe('출력 환경설정'),
  },
  async ({ intent, session_id, attachments, preferences }) => {
    const sessionId = session_id ?? uuidv4();
    const llm = createSamplingCaller(server);
    const agent = new OrchestratorAgent(llm);

    try {
      const result = await agent.run({
        intent,
        sessionId,
        attachments,
        preferences: preferences
          ? {
              slideCount: preferences.slide_count,
              style: preferences.style,
              template: preferences.template,
              outputFormat: preferences.output_format,
            }
          : undefined,
      });

      if (result.status === 'done') {
        const progressSummary = result.progress
          .map((p) => `[${p.agent}] ${p.step}: ${p.message}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: [
                '✅ 작업 완료!',
                '',
                `📄 출력 파일: ${result.outputPath || '(없음)'}`,
                '',
                '📋 진행 로그:',
                progressSummary,
              ].join('\n'),
            },
          ],
        };
      }

      if (result.status === 'checkpoint') {
        const optionsList = result.options
          .map((opt, i) => `${i + 1}. ${opt}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: [
                '⏸️ 확인이 필요합니다.',
                '',
                result.question,
                '',
                '선택지:',
                optionsList,
                '',
                `체크포인트 ID: ${result.checkpointId}`,
                '',
                '`answer_checkpoint` 도구로 답변을 제출하세요.',
              ].join('\n'),
            },
          ],
        };
      }

      // error
      return {
        content: [
          {
            type: 'text',
            text: `❌ 오류 발생: ${result.message}`,
          },
        ],
        isError: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `❌ 내부 오류: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── answer_checkpoint ─────────────────────────────────────────

server.tool(
  'answer_checkpoint',
  '체크포인트에서 확인 요청에 답변하고 작업을 재개합니다.',
  {
    checkpoint_id: z.string().describe('체크포인트 ID'),
    selected_option: z.string().describe('선택한 옵션 텍스트'),
    session_id: z.string().describe('세션 ID'),
  },
  async ({ checkpoint_id, selected_option, session_id }) => {
    const checkpoint = checkpointManager.getCheckpoint(checkpoint_id);
    if (!checkpoint) {
      return {
        content: [{ type: 'text', text: '❌ 체크포인트를 찾을 수 없습니다.' }],
        isError: true,
      };
    }

    const llm = createSamplingCaller(server);
    const agent = new OrchestratorAgent(llm);
    try {
      const result = await agent.run({
        intent: '',
        sessionId: session_id,
        checkpointAnswer: {
          checkpointId: checkpoint_id,
          selectedOption: selected_option,
        },
      });

      if (result.status === 'done') {
        return {
          content: [
            {
              type: 'text',
              text: [
                '✅ 작업 재개 및 완료!',
                `📄 출력 파일: ${result.outputPath || '(없음)'}`,
              ].join('\n'),
            },
          ],
        };
      }

      if (result.status === 'checkpoint') {
        return {
          content: [
            {
              type: 'text',
              text: [
                '⏸️ 추가 확인이 필요합니다.',
                result.question,
                `체크포인트 ID: ${result.checkpointId}`,
              ].join('\n'),
            },
          ],
        };
      }

      return {
        content: [{ type: 'text', text: `❌ 오류: ${result.message}` }],
        isError: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `❌ 내부 오류: ${message}` }],
        isError: true,
      };
    }
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
      return {
        content: [{ type: 'text', text: '등록된 참고문헌이 없습니다.' }],
      };
    }

    const list = entries
      .map((e, i) => {
        const authors = e.authors.length > 0 ? e.authors.join(', ') : '저자 미상';
        return `${i + 1}. [${e.id}] ${e.title} - ${authors} (${e.year}) [${e.source}]`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `📚 참고문헌 목록 (${entries.length}건)\n\n${list}`,
        },
      ],
    };
  },
);

// ─── 서버 시작 ─────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('uni-agent MCP server started');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
