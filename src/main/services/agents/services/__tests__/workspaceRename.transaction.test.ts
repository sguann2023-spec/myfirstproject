import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))
vi.mock('@main/utils', () => ({ getDataPath: () => '/unused' }))
vi.mock('@main/utils/markdownParser', () => ({ parsePluginMetadata: vi.fn() }))
vi.mock('@types', () => ({ AgentBaseSchema: {} }))
vi.mock('../claudecode/commands', () => ({ builtinSlashCommands: [] }))
vi.mock('../../BaseService', () => ({ BaseService: class {
  async getDatabase() { throw new Error('mock required') }
  deserializeJsonFields(row: any) { return structuredClone(row) }
  serializeJsonFields(row: any) { return row }
} }))
vi.mock('../../database/schema', () => ({ sessionsTable: { id: 'id' }, agentsTable: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), asc: vi.fn(), count: vi.fn(), desc: vi.fn(), isNull: vi.fn(), sql: vi.fn() }))
import { SessionService } from '../SessionService'
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })) })
function setup(fail: 'write' | 'commit' | 'recreated' | '' = '') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rename-tx-')))
  roots.push(root)
  const source = path.join(root, 'old'), target = path.join(root, 'new')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'keep.txt'), 'kept')
  const rows = [
    { id: 'one', agent_id: 'a', accessible_paths: [source, `${source}/sub`, `${source}-other`], configuration: { selected_workspace_path: source, other: true } },
    { id: 'two', agent_id: 'b', accessible_paths: [`${source}/sub`], configuration: { selected_workspace_path: `${source}/sub` } }
  ]
  const writes: any[] = []
  const database = { transaction: async (callback: any) => {
    const result = await callback({ select: () => ({ from: async () => rows }), update: () => ({ set: (value: any) => ({ where: async () => {
      if (fail === 'write') throw new Error('write failure')
      writes.push(value)
    } }) }) })
    if (fail === 'recreated') { fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'other.txt'), 'unrelated'); throw new Error('commit failure') }
    if (fail === 'commit') throw new Error('commit failure')
    return result
  } }
  const service = new SessionService()
  vi.spyOn(service, 'getDatabase').mockResolvedValue(database as any)
  return { service, source, target, writes, rows }
}
describe('workspace rename transaction', () => {
  it('moves real files and updates all associated sessions across agents', async () => {
    const { service, source, target, writes } = setup()
    const result = await service.renameWorkspace(source, 'new', () => false)
    expect(result.sessions).toHaveLength(2)
    expect(writes[0].accessible_paths).toEqual([target, `${target}/sub`, `${source}-other`])
    expect(writes[0].configuration).toEqual({ selected_workspace_path: target, other: true })
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('kept')
    expect(fs.existsSync(source)).toBe(false)
  })
  it.each(['write', 'commit'] as const)('restores the original directory after %s failure', async (fail) => {
    const { service, source, target } = setup(fail)
    await expect(service.renameWorkspace(source, 'new', () => false)).rejects.toThrow('重命名失败，请稍后重试')
    expect(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8')).toBe('kept')
    expect(fs.existsSync(target)).toBe(false)
  })
  it('treats the unchanged name as a no-op', async () => {
    const { service, source, writes } = setup()
    const result = await service.renameWorkspace(source, 'old', () => false)
    expect(result.target).toBe(source)
    expect(writes).toHaveLength(0)
    expect(fs.existsSync(source)).toBe(true)
  })
  it('does not overwrite an existing directory', async () => {
    const { service, source, target, writes } = setup()
    fs.mkdirSync(target)
    await expect(service.renameWorkspace(source, 'new', () => false)).rejects.toThrow('已存在')
    expect(fs.existsSync(source)).toBe(true)
    expect(writes).toHaveLength(0)
  })
  it('does not move directories while a session is busy', async () => {
    const { service, source, target, writes } = setup()
    await expect(service.renameWorkspace(source, 'new', () => true)).rejects.toThrow('运行中')
    expect(fs.existsSync(source)).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
    expect(writes).toHaveLength(0)
  })
})

it('reports a real missing source without recreating it or leaking its path', async () => {
  const { service, source, target, writes } = setup();
  fs.rmSync(source, { recursive: true });
  await expect(service.renameWorkspace(source, 'new', () => false)).rejects.toThrow('原工作空间目录不存在，请重新选择工作空间');
  expect(fs.existsSync(source)).toBe(false);
  expect(fs.existsSync(target)).toBe(false);
  expect(writes).toHaveLength(0);
});
it('rejects a stale path even when another folder now exists there', async () => {
  const { service, source, target, writes, rows } = setup();
  rows.forEach(row => { row.accessible_paths = [target]; row.configuration.selected_workspace_path = target; });
  await expect(service.renameWorkspace(source, 'new', () => false)).rejects.toThrow('信息已过期');
  expect(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8')).toBe('kept');
  expect(fs.existsSync(target)).toBe(false);
  expect(writes).toHaveLength(0);
});

it('does not overwrite a file with the requested name', async () => {
  const { service, source, target, writes } = setup();
  fs.writeFileSync(target, 'unrelated');
  await expect(service.renameWorkspace(source, 'new', () => false)).rejects.toThrow('同名文件或文件夹已存在');
  expect(fs.readFileSync(target, 'utf8')).toBe('unrelated');
  expect(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8')).toBe('kept');
  expect(writes).toHaveLength(0);
});
it('does not overwrite a recreated source during rollback and hides recovery paths', async () => {
  const { service, source, target } = setup('recreated');
  await expect(service.renameWorkspace(source, 'new', () => false)).rejects.toThrow('重命名失败且目录恢复失败，请停止操作并联系支持人员');
  expect(fs.readFileSync(path.join(source, 'other.txt'), 'utf8')).toBe('unrelated');
  expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('kept');
});
