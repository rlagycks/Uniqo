import type { LLMCaller } from '../mcp/sampling.js';
import type {
  WriterInput,
  Draft,
  Section,
  OutputType,
  PaperSummary,
  UserPreferences,
} from '../types/index.js';
import { contextManager } from '../context/manager.js';
import { referenceStore } from '../reference/store.js';
import { buildCitationRefs, formatInlineCitation } from '../reference/citation.js';

const MIN_SELF_REVIEW_SCORE = 0.7;
const MAX_REVIEW_ITERATIONS = 2;

const STYLE_INSTRUCTIONS: Record<NonNullable<UserPreferences['style']>, string> = {
  academic: '논문체(-이다, -한다)로 작성하세요.',
  detailed: '상세하게 근거와 예시를 포함하세요.',
  minimal: '핵심 포인트만 간결하게 작성하세요.',
};

export class WriterAgent {
  constructor(private llm: LLMCaller) {}

  async run(input: WriterInput): Promise<Draft> {
    // 1. 주요 논점 추출
    const keyPoints = await this.extractKeyPoints(input.researchReport.papers);

    // 2. 목차 설계
    const structure = await this.designStructure(
      input.intent,
      input.outputType,
      keyPoints,
      input.refinementHint,
      input.preferences,
    );

    // 3. 섹션별 초안 작성
    const sections = await this.writeSections(
      structure,
      input.researchReport.papers,
      input.outputType,
      input.preferences,
    );

    // 4. 전체 콘텐츠 조합
    let content = this.assembleDraft(sections, input.outputType, input.intent);

    // 5. 자체 검토 루프
    let selfReviewScore = 0;
    for (let i = 0; i < MAX_REVIEW_ITERATIONS; i++) {
      const review = await this.selfReview(content, input.intent, input.outputType);
      selfReviewScore = review.score;

      if (selfReviewScore >= MIN_SELF_REVIEW_SCORE) break;

      // 개선 사항 반영
      content = await this.revise(content, review.suggestions, input.outputType);
    }

    // 6. 인용 추적
    const usedRefIds = sections.flatMap((s) =>
      s.refIds.map((refId) => ({
        refId,
        context: s.content.slice(0, 100),
        sectionTitle: s.title,
      })),
    );
    const allEntries = referenceStore.list();
    const citations = buildCitationRefs(allEntries, usedRefIds);

    return {
      outputType: input.outputType,
      structure: sections,
      content,
      selfReviewScore,
      citations,
      title: this.extractTitle(input.intent),
    };
  }

  private async extractKeyPoints(papers: PaperSummary[]): Promise<string[]> {
    if (papers.length === 0) return [];

    const abstracts = papers
      .slice(0, 5)
      .map((p) => `- ${p.title}: ${(p.keyPoints[0] ?? p.abstract ?? '').slice(0, 200)}`)
      .join('\n');

    const prompt = `
다음 논문들의 핵심 논점을 5개 이내로 추출해주세요.

${abstracts}

JSON 배열로 응답: ["논점1", "논점2", ...]
`.trim();

    const text = await this.llm(prompt, 512);
    try {
      const match = text.match(/\[[\s\S]*\]/);
      return match ? (JSON.parse(match[0]) as string[]) : [];
    } catch {
      return [];
    }
  }

  private async designStructure(
    intent: string,
    outputType: OutputType,
    keyPoints: string[],
    refinementHint?: string,
    preferences?: UserPreferences,
  ): Promise<string[]> {
    const typeGuide =
      outputType === 'ppt'
        ? '발표 슬라이드 구성 (표지, 목차, 본론 섹션들, 결론, 참고문헌)'
        : outputType === 'report'
          ? '학술 보고서 구성 (서론, 이론적 배경, 본론, 결론, 참고문헌)'
          : '강의 노트 구성 (개요, 주요 개념, 예시, 요약)';

    const slideCountInstruction = preferences?.slideCount
      ? `정확히 ${preferences.slideCount}개 섹션으로 구성하세요.`
      : '섹션은 5~10개 사이로 구성하세요.';

    const styleInstruction = preferences?.style ? STYLE_INSTRUCTIONS[preferences.style] : '';

    const prompt = `
요청: "${intent}"
형식: ${typeGuide}
핵심 논점: ${keyPoints.slice(0, 3).join(', ')}
${refinementHint ? `특별 지시: ${refinementHint}` : ''}
${styleInstruction ? `문체 지시: ${styleInstruction}` : ''}

위 요청에 맞는 섹션 목차를 JSON 배열로 생성하세요.
${slideCountInstruction}

예시: ["서론", "AI의 정의와 역사", "윤리적 쟁점", "사례 분석", "결론", "참고문헌"]
`.trim();

    const text = await this.llm(prompt, 512);
    try {
      const match = text.match(/\[[\s\S]*\]/);
      return match ? (JSON.parse(match[0]) as string[]) : ['서론', '본론', '결론'];
    } catch {
      return ['서론', '본론', '결론'];
    }
  }

  private async writeSections(
    structure: string[],
    papers: PaperSummary[],
    outputType: OutputType,
    preferences?: UserPreferences,
  ): Promise<Section[]> {
    const sections: Section[] = [];
    const refIds: string[] = papers.map((p) => p.refId);

    const styleInstruction = preferences?.style ? STYLE_INSTRUCTIONS[preferences.style] : '';

    for (const sectionTitle of structure) {
      // 관련 청크 검색
      const chunks = await contextManager.getRelevantChunks(sectionTitle, 4);

      const chunkContext = contextManager.buildRetrievedContext(chunks);

      // 참고 논문 정보
      const refEntries = refIds
        .map((id) => referenceStore.get(id))
        .filter((e) => e !== null)
        .slice(0, 3);

      const refContext = refEntries
        .map((e) => {
          const citation = formatInlineCitation(e!);
          return `${citation}: ${e!.title}`;
        })
        .join('\n');

      const typeInstructions =
        outputType === 'ppt'
          ? '슬라이드 형식으로 작성. 핵심 포인트는 불릿 포인트, 각 슬라이드는 --- 로 구분.'
          : outputType === 'report'
            ? '학술 보고서 형식. 논리적 흐름, 인용 표기 포함.'
            : '학습 노트 형식. 개념 정의, 예시 포함.';

      const prompt = `
섹션: "${sectionTitle}"
형식 지시: ${typeInstructions}
${styleInstruction ? `문체 지시: ${styleInstruction}` : ''}

관련 자료:
${chunkContext || '(직접 지식을 활용하세요)'}

참고 문헌:
${refContext || '(없음)'}

위 섹션의 내용을 한국어로 작성해주세요.
인용이 있으면 (저자, 연도) 형식으로 표기하세요.
`.trim();

      const content = await this.llm(prompt, 1024);

      // 사용된 refId 표시
      const usedRefs = refEntries
        .filter((e) => e && content.includes(e.citationKey))
        .map((e) => e!.id);

      sections.push({
        title: sectionTitle,
        content,
        refIds: usedRefs,
      });

      contextManager.clearWorkingChunks();
    }

    return sections;
  }

  private assembleDraft(sections: Section[], outputType: OutputType, intent: string): string {
    const title = this.extractTitle(intent);

    if (outputType === 'ppt') {
      return this.assembleMarpSlides(title, sections);
    } else if (outputType === 'report') {
      return this.assembleReport(title, sections);
    } else {
      return this.assembleNotes(title, sections);
    }
  }

  private assembleMarpSlides(title: string, sections: Section[]): string {
    const header = `---
marp: true
theme: default
paginate: true
header: "${title}"
footer: "uni-agent | ${new Date().toLocaleDateString('ko-KR')}"
---

# ${title}

---
`;

    const mainSections = sections.filter((s) => s.title !== '참고문헌');
    const refSection = sections.find((s) => s.title === '참고문헌');

    const body = mainSections
      .map((s) => `## ${s.title}\n\n${s.content}`)
      .join('\n\n---\n\n');

    const refPart = refSection
      ? `\n\n---\n\n## ${refSection.title}\n\n${refSection.content}`
      : '';

    return header + body + refPart;
  }

  private assembleReport(title: string, sections: Section[]): string {
    const header = `---
title: "${title}"
date: "${new Date().toLocaleDateString('ko-KR')}"
lang: ko
---

# ${title}

`;
    const body = sections
      .map((s) => `## ${s.title}\n\n${s.content}`)
      .join('\n\n');

    return header + body;
  }

  private assembleNotes(title: string, sections: Section[]): string {
    const header = `# ${title}\n\n`;
    const body = sections.map((s) => `## ${s.title}\n\n${s.content}`).join('\n\n');
    return header + body;
  }

  private async selfReview(
    content: string,
    intent: string,
    outputType: OutputType,
  ): Promise<{ score: number; suggestions: string[] }> {
    const preview = content.slice(0, 6000);

    const prompt = `
요청: "${intent}"
형식: ${outputType}

초안 일부:
${preview}

다음 기준으로 0.0~1.0 점수와 개선 제안을 제공하세요:
1. 요청 충족도
2. 논리 구조
3. 내용 완결성

JSON으로 응답: { "score": 0.8, "suggestions": ["제안1", "제안2"] }
`.trim();

    const text = await this.llm(prompt, 512);
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { score: number; suggestions: string[] };
        return {
          score: typeof parsed.score === 'number' ? parsed.score : 0.5,
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        };
      }
    } catch {
      // 파싱 실패
    }

    return { score: 0.5, suggestions: [] };
  }

  private async revise(
    content: string,
    suggestions: string[],
    outputType: OutputType,
  ): Promise<string> {
    if (suggestions.length === 0) return content;

    const prompt = `
다음 초안을 개선 사항에 따라 수정해주세요.

개선 사항:
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

형식: ${outputType}

초안:
${content.slice(0, 8000)}

개선 사항을 반영하여 수정된 전체 초안을 반환하세요.
`.trim();

    const text = await this.llm(prompt, 8192);
    return text || content;
  }

  private extractTitle(intent: string): string {
    const cleaned = intent
      .replace(/['"]/g, '')
      .replace(/\s*(만들어\s*줘|작성해\s*줘|써\s*줘|해\s*줘|생성해\s*줘|준비해\s*줘|정리해\s*줘)$/u, '')
      .trim();
    return cleaned.length <= 30 ? cleaned : cleaned.slice(0, 30) + '...';
  }
}
