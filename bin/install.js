#!/usr/bin/env node
// uni-agent 설치 마법사
// npx uni-agent install

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ─── OS별 Claude Desktop 설정 경로 ────────────────────────────

function getClaudeConfigPath() {
  switch (process.platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      );
    case 'win32':
      return path.join(process.env['APPDATA'] ?? os.homedir(), 'Claude', 'claude_desktop_config.json');
    case 'linux':
      return path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
    default:
      throw new Error(`지원하지 않는 OS: ${process.platform}`);
  }
}

// ─── Pandoc 설치 확인 ─────────────────────────────────────────

function isPandocInstalled() {
  try {
    execSync('pandoc --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ─── 설치 메인 로직 ───────────────────────────────────────────

async function install() {
  console.log('');
  console.log('╔══════════════════════════════════╗');
  console.log('║   🎓 uni-agent v2.0.0            ║');
  console.log('║   한국 대학생 학업 자동화 MCP     ║');
  console.log('╚══════════════════════════════════╝');
  console.log('');

  // 1. 설정 파일 경로 확인
  let configPath;
  try {
    configPath = getClaudeConfigPath();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  console.log(`📁 Claude Desktop 설정 경로: ${configPath}`);

  // 2. 기존 설정 읽기
  let config = {};
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    console.log(`📂 설정 디렉토리 생성: ${configDir}`);
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(raw);
      console.log('✅ 기존 설정 파일 읽기 완료');
    } catch {
      console.log('⚠️  기존 설정 파일 파싱 실패, 새로 생성합니다');
      config = {};
    }
  } else {
    console.log('📝 새 설정 파일을 생성합니다');
  }

  // 3. mcpServers 섹션 확인/초기화
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // 4. uni-agent 항목 추가 (기존 항목 덮어쓰지 않음)
  const serverPath = path.join(PACKAGE_ROOT, 'dist', 'mcp', 'server.js');

  if (config.mcpServers['uni-agent']) {
    console.log('⚠️  uni-agent가 이미 등록되어 있습니다. 업데이트합니다...');
  }

  config.mcpServers['uni-agent'] = {
    command: 'node',
    args: [serverPath],
    env: {},
  };

  // 5. Pandoc 확인
  const hasPandoc = isPandocInstalled();
  if (hasPandoc) {
    console.log('✅ Pandoc 설치 확인됨 (DOCX 출력 가능)');
  } else {
    console.log('⚠️  Pandoc이 설치되어 있지 않습니다.');
    console.log('   DOCX 출력을 사용하려면 pandoc.org에서 설치하세요.');
    console.log('   (마크다운 출력은 Pandoc 없이도 사용 가능합니다)');
  }

  // 6. 플러그인 디렉토리 초기화
  const pluginDir = path.join(os.homedir(), '.uni-agent', 'plugins');
  fs.mkdirSync(pluginDir, { recursive: true });

  const examplePath = path.join(pluginDir, 'example-plugin.js.txt');
  if (!fs.existsSync(examplePath)) {
    const exampleContent = [
      '// uni-agent 플러그인 예시',
      '// 이 파일을 .js로 복사 후 수정하세요',
      '',
      'export class MyPlugin {',
      '  name = "my-plugin";',
      '  version = "1.0.0";',
      '  description = "커스텀 파일 파서";',
      '  supportedExtensions = ["xyz"];  // 처리할 확장자',
      '',
      '  async execute({ filePath }) {',
      '    return { success: true, text: "파싱된 내용", metadata: { title: "제목" } };',
      '  }',
      '}',
    ].join('\n');
    fs.writeFileSync(examplePath, exampleContent, 'utf-8');
  }
  console.log(`📦 플러그인 디렉토리: ${pluginDir}`);

  // 7. 설정 파일 저장
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log('');
  console.log('✅ 설치 완료!');
  console.log('');
  console.log('━'.repeat(40));
  console.log('🚀 다음 단계:');
  console.log('   1. Claude Desktop을 완전히 종료합니다');
  console.log('   2. Claude Desktop을 다시 실행합니다');
  console.log('   3. 채팅창에서 다음 도구를 사용할 수 있습니다:');
  console.log('      • run_task        - 과제 자동 처리');
  console.log('      • answer_checkpoint - 확인 요청 답변');
  console.log('      • list_references  - 참고문헌 조회');
  console.log('');
  console.log(`📦 플러그인 디렉토리: ${pluginDir}`);
  console.log('   커스텀 에이전트를 등록하려면 위 디렉토리를 참고하세요.');
  console.log('');
  console.log('💡 사용 예시:');
  console.log('   "AI 윤리 발표 12장 만들어줘"');
  console.log('   "기후변화 보고서 작성해줘"');
  console.log('');
  console.log('ℹ️  첫 실행 시 임베딩 모델(~280MB)을 자동 다운로드합니다.');
  console.log('   이후에는 로컬 캐시를 사용하므로 추가 다운로드가 없습니다.');
  console.log('━'.repeat(40));
  console.log('');
}

// ─── 진입점 ───────────────────────────────────────────────────

const command = process.argv[2];

if (command === 'install' || !command) {
  install().catch((err) => {
    console.error('❌ 설치 실패:', err.message);
    process.exit(1);
  });
} else {
  console.log(`알 수 없는 명령: ${command}`);
  console.log('사용법: npx uni-agent install');
  process.exit(1);
}
