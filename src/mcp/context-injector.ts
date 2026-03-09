import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TOOL_CONTEXT_HINTS: Record<string, string> = {
  plan_task: '작업 목표를 설정하고 마일스톤을 계획합니다. 가장 먼저 호출하세요.',
  search_papers: '학술 논문 검색 시 한국어·영문 키워드를 모두 사용하세요.',
  register_references: '검색 결과에서 가장 관련성 높은 논문만 선별해 등록하세요.',
  save_output: 'Marp 마크다운(PPT) 또는 일반 마크다운(보고서·노트)을 저장합니다.',
  list_references: '등록된 레퍼런스 목록을 조회합니다.',
  parse_file: '파일 경로는 절대 경로여야 합니다.',
};

class ContextInjector {
  private projectContext = '';

  init(cwd = process.cwd()): void {
    const candidates = ['CLAUDE.md', 'README.md'];
    const parts: string[] = [];
    for (const file of candidates) {
      const path = join(cwd, file);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, 'utf-8').slice(0, 2000);
          parts.push(`[${file}]\n${content}`);
        } catch {
          // 읽기 실패 시 무시
        }
      }
    }
    this.projectContext = parts.join('\n\n');
  }

  getContext(toolName: string): string {
    const hint = TOOL_CONTEXT_HINTS[toolName] ?? '';
    if (!this.projectContext) return hint;
    return `${hint}\n\n[프로젝트 컨텍스트]\n${this.projectContext}`;
  }
}

export const contextInjector = new ContextInjector();
