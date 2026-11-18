import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { WELCOME_ASSETS, WELCOME_ASSET_BASE } from '../../shared/templateWelcomeAssets'
import type { DraftTemplate } from './draftTemplate'

/** Resolve exact bundled asset references, or rebind previously tagged references after an install moves. */
export function resolveWelcomeAssetPaths(template: DraftTemplate, resourcesRoot: string): DraftTemplate {
  const result = structuredClone(template)
  const knownPaths: string[] = Object.values(WELCOME_ASSETS)
  for (const material of result.materials?.videos ?? []) {
    if (material.type !== 'photo' || typeof material.path !== 'string') continue
    let asset = knownPaths.find(asset => material.path === asset)
    const binding = material.editor_builtin_asset
    if (!asset && binding && typeof binding === 'object' && !Array.isArray(binding)) {
      const { source, resolved_path } = binding as Record<string, unknown>
      // A path edited by the user is no longer a bundled reference, even if its suffix matches.
      if (typeof source === 'string' && knownPaths.includes(source) && material.path === resolved_path) asset = source
    }
    if (!asset) continue
    const relative = asset.slice(WELCOME_ASSET_BASE.length)
    material.path = pathToFileURL(path.join(resourcesRoot, 'template-presets', 'personalized-welcome', relative)).href
    material.editor_builtin_asset = { source: asset, resolved_path: material.path }
  }
  return result
}
