const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function getDeveloperIdIdentity() {
  const preferred = process.env.CSC_NAME?.trim()
  if (preferred) {
    return preferred
  }

  const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })

  const match = output.match(/"([^"]*Developer ID Application:[^"]*)"/)
  if (!match) {
    throw new Error('No Developer ID Application identity found in keychain.')
  }

  return match[1]
}

function verifyCodeSignature(filePath, deep = false) {
  const args = ['--verify']
  if (deep) {
    args.push('--deep')
  }
  args.push('--strict', '--verbose=4', filePath)
  run('codesign', args)
}

function signBinary(identity, filePath) {
  run('codesign', ['--force', '--sign', identity, '--timestamp', '--options', 'runtime', filePath])
  verifyCodeSignature(filePath)
}

module.exports = async function afterSign(context) {
  if (process.platform !== 'darwin') {
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    throw new Error(`Signed app not found: ${appPath}`)
  }

  const identity = getDeveloperIdIdentity()
  const entitlements = path.resolve(
    context.packager.projectDir,
    context.packager.config.mac?.entitlements || 'build-resources/entitlements.mac.plist'
  )

  const ffprobeCandidates = [
    path.join(
      appPath,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      'ffprobe-static',
      'bin',
      'darwin',
      'x64',
      'ffprobe'
    ),
    path.join(
      appPath,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      'ffprobe-static',
      'bin',
      'darwin',
      'arm64',
      'ffprobe'
    )
  ]

  for (const ffprobePath of ffprobeCandidates) {
    if (!fs.existsSync(ffprobePath)) {
      continue
    }

    console.log(`[afterSign] Signing ffprobe: ${ffprobePath}`)
    signBinary(identity, ffprobePath)
  }

  console.log(`[afterSign] Re-signing app bundle: ${appPath}`)
  run('codesign', [
    '--force',
    '--deep',
    '--sign',
    identity,
    '--timestamp',
    '--options',
    'runtime',
    '--entitlements',
    entitlements,
    appPath
  ])

  verifyCodeSignature(appPath, true)
}
