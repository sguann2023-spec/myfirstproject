import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const fixtureRoot = () => path.join(app.getAppPath(), 'dev-fixtures', 'homepage-operations')

/** Development only. Production always uses the real service, even if the env flag is set. */
export function isHomepageOperationsMockEnabled(): boolean {
  if (app.isPackaged || typeof app.getAppPath !== 'function' || !app.getAppPath()) return false
  if (process.env.HOMEPAGE_OPERATIONS_MOCK === '0') return false
  if (process.env.HOMEPAGE_OPERATIONS_MOCK === '1') return true
  try { return JSON.parse(readFileSync(path.join(fixtureRoot(), 'config.json'), 'utf-8')).enabled === true }
  catch { return false }
}

export async function readHomepageOperationsMockResponse(): Promise<unknown> {
  if (!isHomepageOperationsMockEnabled()) throw new Error('Homepage mock is disabled')
  return JSON.parse(await fs.readFile(path.join(fixtureRoot(), 'response.json'), 'utf-8'))
}

/** Replace only package transport; extraction validation, versioning and execution use the real flow. */
export async function extractHomepageMockPackage(folderName: string, downloadUrl: string, destination: string): Promise<void> {
  if (!isHomepageOperationsMockEnabled()
    || downloadUrl !== `https://homepage-mock.invalid/packages/${folderName}.zip`) throw new Error('Invalid homepage mock package')
  const config = JSON.parse(await fs.readFile(path.join(fixtureRoot(), 'config.json'), 'utf-8'))
  const relativeSource = config.sources?.[folderName]
  if (typeof relativeSource !== 'string') throw new Error(`Missing homepage mock package: ${folderName}`)
  const appRoot = path.resolve(app.getAppPath())
  const source = path.resolve(appRoot, relativeSource)
  if (!source.startsWith(appRoot + path.sep)) throw new Error('Mock package is outside the project')
  const target = path.join(destination, folderName)
  await fs.cp(source, target, { recursive: true })
  // UI-only examples for bundled skills are overlays; source bundled skills are not changed.
  const overlay = path.join(fixtureRoot(), 'skills', folderName, 'example.json')
  await fs.copyFile(overlay, path.join(target, 'example.json'))
}
