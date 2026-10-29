import fs from 'node:fs'
import path from 'node:path'

export const workspaceActivity = { renaming: false, runs: 0 }

export function remapWorkspacePath(value: string, source: string, target: string): string {
  if (!value || !path.isAbsolute(value)) return value
  const relative = path.relative(source, value)
  return relative === '' ? target : relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? path.join(target, relative) : value
}

export function validateWorkspaceRename(source: string, name: string): string {
  if (typeof source !== 'string' || !path.isAbsolute(source) || path.resolve(source) === path.parse(source).root) {
    throw new Error('无效的工作空间路径')
  }
  if (typeof name === 'string' && Array.from(name).length > 20) throw new Error('工作空间名称最多20字')
  if (typeof name !== 'string' || !name || name !== name.trim() || name === '.' || name === '..'
    || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) || Buffer.byteLength(name) > 255) {
    throw new Error('请输入有效的文件夹名称（不能包含路径或特殊字符）')
  }
  let stat: fs.Stats
  try { stat = fs.lstatSync(source) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('原工作空间目录不存在，请重新选择工作空间')
    throw new Error('无法访问工作空间目录，请检查权限后重试')
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(source) !== path.resolve(source)) {
    throw new Error('仅支持重命名真实目录，不支持符号链接路径')
  }
  const target = path.join(path.dirname(source), name)
  if (target !== path.resolve(source)) {
    let exists = false
    try { fs.lstatSync(target); exists = true } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (exists) throw new Error('同名文件或文件夹已存在')
  }
  return target
}

// Never send native filesystem/SQL errors (which contain private paths) to IPC clients.
export function workspaceRenameError(error: unknown): Error {
  const message = error instanceof Error ? error.message : ''
  if (/^(原工作空间|无法访问工作空间|无效的工作空间|工作空间名称|请输入有效|仅支持重命名|同名文件|存在运行中|工作空间未关联|工作空间信息已过期)/.test(message)) return new Error(message)
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return new Error('原工作空间目录不存在，请重新选择工作空间')
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return new Error('同名文件或文件夹已存在')
  if (code === 'EACCES' || code === 'EPERM') return new Error('无法访问工作空间目录，请检查权限后重试')
  return new Error('重命名失败，请稍后重试')
}
