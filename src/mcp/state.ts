import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentState, Milestone } from '../types/index.js';

const STATE_DIR = join(homedir(), '.uni-agent');
const STATE_FILE = join(STATE_DIR, 'state.json');

function makeDefault(): AgentState {
  return {
    goal: '',
    status: 'idle',
    startedAt: new Date().toISOString(),
    milestones: [],
    retryCount: 0,
    errors: [],
  };
}

class StateManager {
  private state: AgentState = makeDefault();

  load(): void {
    if (!existsSync(STATE_FILE)) {
      this.state = makeDefault();
      return;
    }
    try {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as AgentState;
      if (typeof parsed.goal === 'string' && Array.isArray(parsed.milestones)) {
        this.state = parsed;
      } else {
        this.state = makeDefault();
      }
    } catch {
      this.state = makeDefault();
    }
  }

  private save(): void {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  getState(): AgentState {
    return { ...this.state };
  }

  setGoal(goal: string): void {
    this.state = {
      goal,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      milestones: [],
      retryCount: 0,
      errors: [],
    };
    this.save();
  }

  addMilestone(name: string): void {
    // Avoid duplicate pending milestones for the same tool
    const existing = this.state.milestones.find(
      (m) => m.name === name && m.status === 'pending',
    );
    if (!existing) {
      this.state.milestones.push({ name, status: 'pending' });
      this.save();
    }
  }

  completeMilestone(name: string): void {
    const milestone = this.state.milestones
      .slice()
      .reverse()
      .find((m): m is Milestone => m.name === name && m.status === 'pending');
    if (milestone) {
      milestone.status = 'done';
      milestone.completedAt = new Date().toISOString();
      this.save();
    }
  }

  failMilestone(name: string): void {
    const milestone = this.state.milestones
      .slice()
      .reverse()
      .find((m): m is Milestone => m.name === name && m.status === 'pending');
    if (milestone) {
      milestone.status = 'failed';
      this.save();
    }
  }

  incrementRetry(): void {
    this.state.retryCount++;
    this.save();
  }

  resetRetry(): void {
    this.state.retryCount = 0;
    this.save();
  }

  addError(msg: string): void {
    this.state.errors.push(msg);
    this.save();
  }

  markDone(): void {
    this.state.status = 'done';
    this.save();
  }

  reset(): void {
    this.state = makeDefault();
    this.save();
  }
}

export const stateManager = new StateManager();
