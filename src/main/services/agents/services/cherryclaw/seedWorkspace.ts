import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('SeedWorkspace')

const HTML_INDEX_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome</title>
    <link rel="stylesheet" href="./assets/css/main.css" />
  </head>
  <body>
    <main class="welcome">
      <span class="welcome__eyebrow">VectCut</span>
      <h1>开始搭建你自己的视频工作流</h1>
      <p>无论是口播、混剪、直播切片，还是信息流广告，都可以从这里开始制作。搭建完成后，你可以一键发布到互联网上，并在手机端直接使用。</p>
    </main>
    <script src="./assets/js/main.js"></script>
  </body>
</html>
`

const HTML_CSS_TEMPLATE = `:root {
  color-scheme: light;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f5f7fb;
  color: #18202a;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at top, rgba(78, 110, 242, 0.18), transparent 32%),
    linear-gradient(180deg, #f8faff 0%, #eef2f9 100%);
}

.welcome {
  width: min(680px, calc(100vw - 32px));
  padding: 48px 40px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(133, 149, 173, 0.2);
  box-shadow: 0 24px 80px rgba(35, 52, 99, 0.12);
  text-align: center;
}

.welcome__eyebrow {
  display: inline-block;
  margin-bottom: 16px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #edf2ff;
  color: #3952d8;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.welcome h1 {
  margin: 0 0 16px;
  font-size: clamp(32px, 6vw, 48px);
  line-height: 1.1;
}

.welcome p {
  margin: 0 auto;
  max-width: 480px;
  font-size: 16px;
  line-height: 1.7;
  color: #4a5568;
}

.welcome__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 28px;
  padding: 12px 20px;
  border-radius: 999px;
  background: #18202a;
  color: #fff;
  text-decoration: none;
  font-weight: 600;
}
`

const HTML_JS_TEMPLATE = `document.addEventListener('DOMContentLoaded', () => {
  console.log('HTML5 workspace is ready.');
});
`

/**
 * The bootstrap instruction is embedded as a constant (not written to disk).
 * It is injected into the system prompt when `bootstrap_completed` is falsy.
 */
export const BOOTSTRAP_INSTRUCTIONS = `## Bootstrap Mode

You are starting a brand-new relationship with your user. Your SOUL.md and USER.md files are empty templates waiting to be filled.

Your goal in this conversation is to:

1. **Introduce yourself** — Explain that you're their personal VectcutClaw agent and this is a one-time setup conversation to figure out what role you should play for them.
2. **Discover the role** — Through natural conversation, understand what the user wants you to be:
   - What kind of assistant do they need? (coding partner, project manager, research aide, creative collaborator, life assistant, etc.)
   - What should your name be? Suggest options that fit the role, or let them choose freely. The name will appear in the app sidebar.
   - What tone and personality fits this role? (professional, casual, playful, concise, thorough, etc.)
   - Any boundaries, things you should never do, or strong preferences?
3. **Learn about the user** — Naturally weave in questions about:
   - Their name and how they'd like to be addressed
   - Their timezone and working hours
   - Communication preferences (language, verbosity, formality)
4. **Commit the identity** — When you have enough information:
   - Rename yourself using \`mcp__claw__config\` (action: "rename", name: the chosen name)
   - Update \`SOUL.md\` with your role definition, personality, tone, principles, and boundaries using the Edit tool
   - Update \`USER.md\` with everything you learned about the user using the Edit tool
   - Log the bootstrap completion using \`mcp__claw__memory\` (append action, tag: "bootstrap")
   - Mark bootstrap as complete using \`mcp__claw__config\` (action: "complete_bootstrap")

Guidelines:
- Keep the conversation natural and warm — this is a first impression
- Ask no more than 3-5 questions total; don't interrogate
- It's okay to make reasonable assumptions and let the user correct you
- Write detailed, thoughtful content to SOUL.md and USER.md — these define your relationship
- Always respect the user's language preference — if they write in Chinese, respond in Chinese
- After marking bootstrap complete, future sessions will use your standard mode with the personality you defined
`

/** Minimum character count for SOUL.md to be considered non-template (already configured). */
export const SOUL_CONTENT_THRESHOLD = 50

/**
 * Seed workspace with template files for soul mode.
 * Idempotent: only writes files that don't already exist.
 */
export async function seedWorkspaceTemplates(workspacePath: string): Promise<void> {
  try {
    // Ensure workspace and its starter directories exist.
    await mkdir(workspacePath, { recursive: true })
    await mkdir(path.join(workspacePath, 'images'), { recursive: true })
    await mkdir(path.join(workspacePath, 'assets'), { recursive: true })
    await mkdir(path.join(workspacePath, 'assets', 'css'), { recursive: true })
    await mkdir(path.join(workspacePath, 'assets', 'js'), { recursive: true })

    const seeds: Array<{ filePath: string; content: string }> = [
      { filePath: path.join(workspacePath, 'index.html'), content: HTML_INDEX_TEMPLATE },
      { filePath: path.join(workspacePath, 'assets', 'css', 'main.css'), content: HTML_CSS_TEMPLATE },
      { filePath: path.join(workspacePath, 'assets', 'js', 'main.js'), content: HTML_JS_TEMPLATE }
    ]

    for (const { filePath, content } of seeds) {
      const exists = await fileExists(filePath)
      if (!exists) {
        await writeFile(filePath, content, 'utf-8')
        logger.info(`Seeded template: ${path.basename(filePath)}`, { path: filePath })
      }
    }
  } catch (error) {
    logger.error('Failed to seed workspace templates', error as Error)
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
