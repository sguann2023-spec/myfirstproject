const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const buildPath = path.resolve(__dirname, '..');
  const electronPath = require('electron');
  const runtimeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const runtime = JSON.parse(execFileSync(electronPath, [
    '-p', 'JSON.stringify({ arch: process.arch, version: process.versions.electron })',
  ], { cwd: buildPath, env: runtimeEnv, encoding: 'utf8', timeout: 15000 }).trim());
  if (!runtime.version || !['x64', 'arm64', 'ia32', 'arm'].includes(runtime.arch)) {
    throw new Error('Could not detect the installed Electron runtime');
  }

  console.log(`Rebuilding better-sqlite3 for Electron ${runtime.version} (${runtime.arch})`);
  const { rebuild } = await import('@electron/rebuild');
  await rebuild({
    buildPath,
    electronVersion: runtime.version,
    arch: runtime.arch,
    onlyModules: ['better-sqlite3'],
    force: true,
  });

  execFileSync(electronPath, ['-e', [
    'const Database = require("better-sqlite3");',
    'const db = new Database(":memory:");',
    'db.prepare("SELECT 1").get();',
    'db.close();',
    'console.log("Electron SQLite load check passed");',
  ].join('\n')], { cwd: buildPath, env: runtimeEnv, stdio: 'inherit', timeout: 15000 });
}

main().catch((error) => {
  console.error('Electron SQLite rebuild failed:', error);
  process.exitCode = 1;
});
