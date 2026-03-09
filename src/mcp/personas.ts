import type { Persona } from '../types/index.js';

export interface PersonaDefinition {
  name: Persona;
  description: string;
  allowedTools: string[];
}

export const PERSONAS: Record<Persona, PersonaDefinition> = {
  architect: {
    name: 'architect',
    description: '목표 설정과 구조 설계를 담당합니다. 마일스톤을 수립하고 작업 계획을 세웁니다.',
    allowedTools: ['plan_task'],
  },
  researcher: {
    name: 'researcher',
    description: '학술 논문 검색과 레퍼런스 등록을 담당합니다.',
    allowedTools: ['search_papers', 'register_references'],
  },
  worker: {
    name: 'worker',
    description: '파일 생성과 저장을 담당합니다.',
    allowedTools: ['save_output'],
  },
  reader: {
    name: 'reader',
    description: '파일 읽기와 레퍼런스 조회를 담당합니다. 쓰기 작업은 수행하지 않습니다.',
    allowedTools: ['parse_file', 'list_references'],
  },
};
