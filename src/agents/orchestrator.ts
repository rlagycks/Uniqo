import { v4 as uuidv4 } from 'uuid';
import * as path from 'node:path';
import { pluginRegistry } from '../plugins/plugin.js';
import type { LLMCaller } from '../mcp/sampling.js';
import type {
  OrchestratorInput,
  TaskResult,
  OutputType,
  StepLog,
  DAGState,
  ResearchReport,
  Draft,
  UserPreferences,
} from '../types/index.js';
import {
  createDAG,
  topologicalSort,
  updateNodeStatus,
  incrementRetry,
  canRetry,
  buildStepLog,
  isDAGComplete,
} from '../workflow/dag.js';
import { checkpointManager } from '../workflow/checkpoint.js';
import { contextManager } from '../context/manager.js';
import { referenceStore } from '../reference/store.js';
import { ResearchAgent } from './research.js';
import { WriterAgent } from './writer.js';
import { FormatterAgent } from './formatter.js';

const MIN_CONFIDENCE = 0.6;
const MIN_PAPERS = 3;
const MAX_AMBIGUITY_SCORE = 0.7;

export class OrchestratorAgent {
  private progress: StepLog[] = [];

  constructor(private llm: LLMCaller) {}

  async run(input: OrchestratorInput): Promise<TaskResult> {
    this.progress = [];

    try {
      // 체크포인트 답변 재개
      if (input.checkpointAnswer) {
        return this.resumeFromCheckpoint(input.checkpointAnswer, input.sessionId);
      }

      // 세션 초기화/로드
      let session = await contextManager.loadSession(input.sessionId);
      if (!session) {
        session = await contextManager.createSession(input.sessionId);
      }

      // 1. 의도 분류
      const { outputType, ambiguityScore } = await this.classifyIntent(input.intent);
      this.log('orchestrator', 'classify', `의도 분류: ${outputType} (모호도: ${ambiguityScore})`);

      // 2. intent에서 슬라이드 수 자동 파싱
      const preferences = this.mergePreferencesFromIntent(input.intent, input.preferences);
      if (preferences.slideCount) {
        this.log('orchestrator', 'parse_intent', `슬라이드 수 파싱: ${preferences.slideCount}`);
      }

      // 3. DAG 생성
      const dagState = createDAG(outputType);
      checkpointManager.saveState(input.sessionId, dagState);

      // 4. 첨부파일 처리
      if (input.attachments && input.attachments.length > 0) {
        // 네이티브 파서 지원 확장자
        const NATIVE_EXTS = new Set(['pdf', 'pptx', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'hwp', 'hwpx']);

        for (const filePath of input.attachments) {
          const ext = path.extname(filePath).slice(1).toLowerCase();
          const plugin = !NATIVE_EXTS.has(ext) ? pluginRegistry.findByExtension(ext) : undefined;

          try {
            if (plugin) {
              // 플러그인으로 파싱
              const result = await pluginRegistry.execute(plugin.name, {
                filePath,
                intent: input.intent,
                sessionId: input.sessionId,
              });

              if (result.success && result.text) {
                await referenceStore.addFromApiResult({
                  title: result.metadata?.title ?? path.basename(filePath),
                  url: `file://${filePath}`,
                  content: result.text,
                });
                this.log('orchestrator', 'parse_attachment', `플러그인 [${plugin.name}] 처리: ${filePath}`);
              } else {
                this.log('orchestrator', 'parse_attachment', `플러그인 오류: ${result.error ?? '알 수 없음'}`);
              }
            } else {
              // 네이티브 파서
              await referenceStore.add({ type: 'file', filePath });
              this.log('orchestrator', 'parse_attachment', `첨부파일 등록: ${filePath}`);
            }
          } catch {
            this.log('orchestrator', 'parse_attachment', `첨부파일 오류: ${filePath}`);
          }
        }
      }

      // 5. DAG 실행
      return this.executeDAG(
        dagState,
        { ...input, preferences },
        outputType,
        ambiguityScore,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }

  /**
   * intent 문자열에서 슬라이드 수를 파싱해 preferences에 병합한다.
   * 예: "12장", "10슬라이드", "15페이지"
   */
  private mergePreferencesFromIntent(
    intent: string,
    preferences?: UserPreferences,
  ): UserPreferences {
    const merged: UserPreferences = { ...preferences };
    if (merged.slideCount) return merged;

    const match =
      intent.match(/(\d+)\s*(?:장|슬라이드|페이지|slide|slides?)/) ??
      intent.match(/슬라이드\s*(\d+)/);
    if (match?.[1]) {
      merged.slideCount = parseInt(match[1], 10);
    }
    return merged;
  }

  private async executeDAG(
    dagState: DAGState,
    input: OrchestratorInput,
    outputType: OutputType,
    ambiguityScore: number,
    refinementHint?: string,
  ): Promise<TaskResult> {
    let state = dagState;
    let researchReport: ResearchReport | null = null;
    let draft: Draft | null = null;

    const sorted = topologicalSort(state);

    for (const node of sorted) {
      if (node.status === 'done' || node.status === 'skipped') continue;

      this.log(node.agent, node.type, `시작`);
      state = { ...state, currentNodeId: node.id };

      let nodeSuccess = false;
      let lastError: string = '';

      while (!nodeSuccess) {
        try {
          if (node.type === 'parse_attachments') {
            // 이미 처리됨
            state = updateNodeStatus(state, node.id, 'done');
            nodeSuccess = true;
          } else if (node.type === 'research') {
            // 모호도 체크포인트
            if (ambiguityScore > MAX_AMBIGUITY_SCORE) {
              const checkpoint = checkpointManager.createCheckpoint(
                input.sessionId,
                '요청이 모호합니다. 어떤 방향으로 진행할까요?',
                [
                  `현재 의도(${outputType})로 진행`,
                  '더 구체적인 주제를 알려주세요',
                  '취소',
                ],
                state,
                `ambiguityScore=${ambiguityScore}`,
                input.intent,
                input.preferences,
              );
              return {
                status: 'checkpoint',
                checkpointId: checkpoint.id,
                question: checkpoint.question,
                options: checkpoint.options,
              };
            }

            const agent = new ResearchAgent(this.llm);
            researchReport = await agent.run({
              topic: input.intent,
              outputType,
              sessionId: input.sessionId,
              refinementHint,
            });

            this.log('research', 'done', `논문 ${researchReport.papers.length}편 수집, 신뢰도: ${researchReport.confidence.toFixed(2)}`);

            // 신뢰도 체크포인트
            if (researchReport.confidence < MIN_CONFIDENCE || researchReport.papers.length < MIN_PAPERS) {
              const checkpoint = checkpointManager.createCheckpoint(
                input.sessionId,
                `자료 신뢰도가 낮습니다 (${(researchReport.confidence * 100).toFixed(0)}%). 어떻게 진행할까요?`,
                [
                  '현재 자료로 계속 진행',
                  '다른 검색어로 재시도',
                  '취소',
                ],
                state,
                `confidence=${researchReport.confidence}, papers=${researchReport.papers.length}`,
                input.intent,
                input.preferences,
              );
              return {
                status: 'checkpoint',
                checkpointId: checkpoint.id,
                question: checkpoint.question,
                options: checkpoint.options,
              };
            }

            state = updateNodeStatus(state, node.id, 'done', {
              papers: researchReport.papers.length,
              confidence: researchReport.confidence,
            });
            nodeSuccess = true;
          } else if (node.type === 'write_ppt' || node.type === 'write_report' || node.type === 'write_notes') {
            if (!researchReport) {
              throw new Error('ResearchReport가 없습니다');
            }

            const agent = new WriterAgent(this.llm);
            draft = await agent.run({
              researchReport,
              outputType,
              intent: input.intent,
              sessionId: input.sessionId,
              preferences: input.preferences,
            });

            this.log('writer', 'done', `초안 완성, 자체검토 점수: ${draft.selfReviewScore.toFixed(2)}`);
            state = updateNodeStatus(state, node.id, 'done', {
              selfReviewScore: draft.selfReviewScore,
            });
            nodeSuccess = true;
          } else if (node.type === 'format_pdf' || node.type === 'format_docx' || node.type === 'save_md') {
            if (!draft) {
              throw new Error('Draft가 없습니다');
            }

            const agent = new FormatterAgent();
            const output = await agent.run({
              draft,
              outputType,
            });

            this.log('formatter', 'done', `파일 생성: ${output.outputPath}`);
            state = updateNodeStatus(state, node.id, 'done', {
              outputPath: output.outputPath,
              format: output.format,
            });

            checkpointManager.saveState(input.sessionId, state);

            return {
              status: 'done',
              outputPath: output.outputPath,
              progress: this.progress,
            };
          }

          checkpointManager.saveState(input.sessionId, state);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          this.log(node.agent, node.type, `오류: ${lastError}`);

          if (canRetry(state, node.id)) {
            state = incrementRetry(state, node.id);
            this.log(node.agent, node.type, `재시도 (${state.nodes.find(n => n.id === node.id)?.retryCount}회)`);
          } else {
            state = updateNodeStatus(state, node.id, 'failed');
            return { status: 'error', message: `${node.type} 실패: ${lastError}` };
          }
        }
      }
    }

    // 모든 노드 완료 (research_only 등)
    if (isDAGComplete(state)) {
      return {
        status: 'done',
        outputPath: '',
        progress: this.progress,
      };
    }

    return { status: 'error', message: '예상치 못한 DAG 종료' };
  }

  private async resumeFromCheckpoint(
    answer: { checkpointId: string; selectedOption: string },
    sessionId: string,
  ): Promise<TaskResult> {
    // "취소" 선택 시 applyAnswer 호출 전에 처리
    if (answer.selectedOption === '취소') {
      return { status: 'error', message: '사용자가 작업을 취소했습니다' };
    }

    const result = checkpointManager.applyAnswer(answer.checkpointId, answer.selectedOption);
    if (!result) {
      return { status: 'error', message: '체크포인트를 찾을 수 없습니다' };
    }

    const { dagState, originalIntent, originalPreferences, refinementHint } = result;

    this.log('orchestrator', 'resume', `체크포인트 재개: ${answer.selectedOption}`);
    if (refinementHint) {
      this.log('orchestrator', 'resume', `힌트: ${refinementHint}`);
    }

    // 원래 의도로 출력 유형 재분류
    const { outputType } = await this.classifyIntent(originalIntent);

    return this.executeDAG(
      dagState,
      { intent: originalIntent, sessionId, preferences: originalPreferences },
      outputType,
      0,
      refinementHint || undefined,
    );
  }

  private async classifyIntent(
    intent: string,
  ): Promise<{ outputType: OutputType; ambiguityScore: number }> {
    const prompt = `
사용자 요청: "${intent}"

다음 중 가장 적합한 출력 유형을 선택하고 확신도를 반환하세요:
- "ppt": 발표 자료, 프레젠테이션, 슬라이드
- "report": 보고서, 논문, 에세이, 레포트
- "notes": 노트, 정리, 요약
- "research_only": 자료 조사만

JSON으로 응답:
{ "outputType": "ppt", "confidence": 0.9 }

confidence가 낮을수록 모호한 요청입니다.
`.trim();

    try {
      const text = await this.llm(prompt, 128);
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { outputType: OutputType; confidence: number };
        return {
          outputType: parsed.outputType ?? 'ppt',
          ambiguityScore: 1 - (parsed.confidence ?? 0.5),
        };
      }
    } catch {
      // 분류 실패 시 기본값
    }

    // 키워드 기반 fallback
    const lower = intent.toLowerCase();
    if (lower.includes('발표') || lower.includes('ppt') || lower.includes('슬라이드')) {
      return { outputType: 'ppt', ambiguityScore: 0.1 };
    }
    if (lower.includes('보고서') || lower.includes('레포트') || lower.includes('논문')) {
      return { outputType: 'report', ambiguityScore: 0.1 };
    }
    if (lower.includes('정리') || lower.includes('노트') || lower.includes('요약')) {
      return { outputType: 'notes', ambiguityScore: 0.2 };
    }

    return { outputType: 'ppt', ambiguityScore: 0.5 };
  }

  private log(agent: string, step: string, message: string): void {
    this.progress.push(buildStepLog(agent as Parameters<typeof buildStepLog>[0], step, message));
  }
}
