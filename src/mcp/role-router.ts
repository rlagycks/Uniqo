import type { Persona } from '../types/index.js';

const TOOL_PERSONA_MAP: Record<string, Persona> = {
  plan_task: 'architect',
  search_papers: 'researcher',
  register_references: 'researcher',
  save_output: 'worker',
  list_references: 'reader',
  parse_file: 'reader',
};

export function getPersona(toolName: string): Persona {
  return TOOL_PERSONA_MAP[toolName] ?? 'reader';
}

export function isAllowed(toolName: string, persona: Persona): boolean {
  return TOOL_PERSONA_MAP[toolName] === persona;
}
