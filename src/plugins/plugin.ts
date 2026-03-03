export interface PluginInput {
  filePath: string;
  intent?: string;
  sessionId?: string;
}

export interface PluginResult {
  success: boolean;
  text?: string;
  metadata?: {
    title?: string;
    authors?: string[];
    year?: number;
    abstract?: string;
  };
  error?: string;
}

export interface PluginAgent {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly supportedExtensions: string[];
  execute(input: PluginInput): Promise<PluginResult>;
  validate?(input: PluginInput): boolean;
}

export class PluginRegistry {
  private plugins: Map<string, PluginAgent> = new Map();

  register(agent: PluginAgent): void {
    this.plugins.set(agent.name, agent);
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  get(name: string): PluginAgent | undefined {
    return this.plugins.get(name);
  }

  list(): PluginAgent[] {
    return Array.from(this.plugins.values());
  }

  findByExtension(ext: string): PluginAgent | undefined {
    const lower = ext.toLowerCase().replace(/^\./, '');
    return this.list().find((p) => p.supportedExtensions.includes(lower));
  }

  async execute(name: string, input: PluginInput): Promise<PluginResult> {
    const agent = this.plugins.get(name);
    if (!agent) return { success: false, error: `Plugin "${name}" not found` };
    if (agent.validate && !agent.validate(input)) {
      return { success: false, error: `Invalid input for plugin "${name}"` };
    }
    try {
      return await agent.execute(input);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const pluginRegistry = new PluginRegistry();
