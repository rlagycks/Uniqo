import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import type { FormatterInput, FormatterOutput, Draft } from '../types/index.js';
import { formatBibliography } from '../reference/citation.js';
import { referenceStore } from '../reference/store.js';

const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Desktop');
const TEMP_DIR = path.join(os.homedir(), '.uni-agent', 'tmp');

export class FormatterAgent {
  async run(input: FormatterInput): Promise<FormatterOutput> {
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    const outputDir = input.outputDir ?? DEFAULT_OUTPUT_DIR;
    fs.mkdirSync(outputDir, { recursive: true });

    // 참고문헌 페이지 추가
    const contentWithBiblio = this.appendBibliography(input.draft);

    switch (input.outputType) {
      case 'ppt':
        return this.formatPdf(contentWithBiblio, input.draft.title, outputDir);
      case 'report':
        return this.formatDocx(contentWithBiblio, input.draft.title, outputDir, input.templateName);
      case 'notes':
      case 'research_only':
        return this.saveMarkdown(contentWithBiblio, input.draft.title, outputDir);
      default:
        return this.saveMarkdown(contentWithBiblio, input.draft.title, outputDir);
    }
  }

  private async formatPdf(content: string, title: string, outputDir: string): Promise<FormatterOutput> {
    const safeName = this.safeFileName(title);
    const inputPath = path.join(TEMP_DIR, `${safeName}.md`);
    const outputPath = path.join(outputDir, `${safeName}.pdf`);

    fs.writeFileSync(inputPath, content, 'utf-8');

    try {
      await this.spawnProcess('npx', [
        '@marp-team/marp-cli',
        inputPath,
        '--pdf',
        '-o',
        outputPath,
        '--allow-local-files',
      ]);

      const stat = fs.statSync(outputPath);
      return { outputPath, format: 'pdf', sizeBytes: stat.size };
    } catch (err) {
      // Marp 실패 시 마크다운으로 저장
      const mdPath = inputPath.replace('.md', '_slides.md');
      fs.copyFileSync(inputPath, mdPath);
      const stat = fs.statSync(mdPath);
      return {
        outputPath: mdPath,
        format: 'md',
        sizeBytes: stat.size,
      };
    } finally {
      this.cleanupTemp(inputPath);
    }
  }

  private async formatDocx(
    content: string,
    title: string,
    outputDir: string,
    templateName?: string,
  ): Promise<FormatterOutput> {
    const safeName = this.safeFileName(title);
    const inputPath = path.join(TEMP_DIR, `${safeName}.md`);
    const outputPath = path.join(outputDir, `${safeName}.docx`);

    fs.writeFileSync(inputPath, content, 'utf-8');

    // Pandoc 설치 여부 확인
    const pandocAvailable = await this.checkCommand('pandoc');
    if (!pandocAvailable) {
      // Pandoc 없으면 마크다운으로 fallback
      const mdOutputPath = path.join(outputDir, `${safeName}.md`);
      fs.writeFileSync(mdOutputPath, content, 'utf-8');
      const stat = fs.statSync(mdOutputPath);
      return {
        outputPath: mdOutputPath,
        format: 'md',
        sizeBytes: stat.size,
      };
    }

    const pandocArgs = [
      inputPath,
      '-o',
      outputPath,
      '--from=markdown',
      '--to=docx',
      '-V',
      'lang=ko',
    ];

    // 템플릿 지정 (있으면)
    const templatePath = this.resolveTemplate(templateName);
    if (templatePath) {
      pandocArgs.push(`--reference-doc=${templatePath}`);
    }

    try {
      await this.spawnProcess('pandoc', pandocArgs);
      const stat = fs.statSync(outputPath);
      return { outputPath, format: 'docx', sizeBytes: stat.size };
    } catch {
      // Pandoc 실패 시 마크다운으로 fallback
      const mdOutputPath = path.join(outputDir, `${safeName}.md`);
      fs.writeFileSync(mdOutputPath, content, 'utf-8');
      const stat = fs.statSync(mdOutputPath);
      return {
        outputPath: mdOutputPath,
        format: 'md',
        sizeBytes: stat.size,
      };
    } finally {
      this.cleanupTemp(inputPath);
    }
  }

  private async saveMarkdown(
    content: string,
    title: string,
    outputDir: string,
  ): Promise<FormatterOutput> {
    const safeName = this.safeFileName(title);
    const outputPath = path.join(outputDir, `${safeName}.md`);
    fs.writeFileSync(outputPath, content, 'utf-8');
    const stat = fs.statSync(outputPath);
    return { outputPath, format: 'md', sizeBytes: stat.size };
  }

  private appendBibliography(draft: Draft): string {
    if (draft.citations.length === 0) return draft.content;

    const usedRefIds = [...new Set(draft.citations.map((c) => c.refId))];
    const entries = usedRefIds
      .map((id) => referenceStore.get(id))
      .filter((e) => e !== null);

    if (entries.length === 0) return draft.content;

    const biblio = formatBibliography(entries.map(e => e!));

    // Marp PPT는 마지막 슬라이드로
    if (draft.outputType === 'ppt') {
      return draft.content + '\n\n---\n\n' + biblio;
    }

    return draft.content + '\n\n' + biblio;
  }

  private spawnProcess(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ${command}: ${err.message}`));
      });
    });
  }

  private async checkCommand(command: string): Promise<boolean> {
    try {
      await this.spawnProcess(command, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  private resolveTemplate(templateName?: string): string | null {
    if (!templateName) return null;

    // 프로젝트 내 템플릿 디렉토리
    // CJS 빌드 기준: __dirname은 dist/mcp/
    const templateDir = path.join(__dirname, '..', '..', 'templates');
    const templatePath = path.join(templateDir, templateName);

    return fs.existsSync(templatePath) ? templatePath : null;
  }

  private safeFileName(title: string): string {
    const timestamp = new Date().toISOString().slice(0, 10);
    const safe = title
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 50);
    return `${safe}_${timestamp}`;
  }

  private cleanupTemp(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // 정리 실패는 무시
    }
  }
}

export const formatterAgent = new FormatterAgent();
