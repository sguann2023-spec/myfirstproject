const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function runOutput(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
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

function signMainExecutable(identity, entitlements, filePath) {
  run('codesign', [
    '--force',
    '--sign',
    identity,
    '--timestamp',
    '--options',
    'runtime',
    '--entitlements',
    entitlements,
    filePath
  ])
  verifyCodeSignature(filePath)
}

function logSignatureDetails(filePath) {
  console.log(`[afterSign] Signature details: ${filePath}`)
  try {
    run('codesign', ['-dvvv', filePath])
  } catch (error) {
    console.log(`[afterSign] Failed to dump signature details for ${filePath}: ${error.message}`)
  }
}

function logArchitectures(filePath) {
  try {
    const archs = runOutput('lipo', ['-archs', filePath])
    console.log(`[afterSign] Architectures for ${filePath}: ${archs}`)
  } catch (error) {
    console.log(`[afterSign] Failed to read architectures for ${filePath}: ${error.message}`)
  }
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
  const mainExecutablePath = path.join(appPath, 'Contents', 'MacOS', context.packager.appInfo.productFilename)

  if (!fs.existsSync(mainExecutablePath)) {
    throw new Error(`Main executable not found: ${mainExecutablePath}`)
  }

  logArchitectures(mainExecutablePath)
  logSignatureDetails(mainExecutablePath)
  console.log(`[afterSign] Re-signing main executable: ${mainExecutablePath}`)
  signMainExecutable(identity, entitlements, mainExecutablePath)

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
    '--sign',
    identity,
    '--timestamp',
    '--options',
    'runtime',
    '--entitlements',
    entitlements,
    appPath
  ])

  logSignatureDetails(appPath)
  verifyCodeSignature(appPath, true)
  run('spctl', ['-a', '-t', 'exec', '-vv', appPath])
}
