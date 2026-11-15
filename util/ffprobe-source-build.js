const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { sha256, assertDigest, assertArchitecture, readRegular } = require('./ffprobe-integrity')

const SOURCE = Object.freeze({
  version: '7.1.3',
  url: 'https://ffmpeg.org/releases/ffmpeg-7.1.3.tar.xz',
  sha256: 'f0bf043299db9e3caacb435a712fc541fbb07df613c4b893e8b77e67baf3adbe',
  license: 'b634ab5640e258563c536e658cad87080553df6f34f62269a21d554844e58bfe',
  readme: '05ba4b92c96605434b1aaae3eedf5a2c280c9607bf78ffca9a5b536d9af2dc6a'
})
function flagsFor(arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported source build architecture')
  const cpu = arch === 'x64' ? 'x86_64' : 'arm64'
  return [
    '--target-os=darwin', `--arch=${cpu}`, '--enable-cross-compile',
    '--cc=/usr/bin/clang', `--extra-cflags=-arch ${cpu} -mmacosx-version-min=11.0`,
    `--extra-ldflags=-arch ${cpu} -mmacosx-version-min=11.0`,
    '--disable-gpl', '--disable-nonfree', '--disable-version3', '--disable-autodetect',
    '--disable-asm', '--disable-inline-asm', '--disable-x86asm',
    '--disable-ffmpeg', '--disable-ffplay', '--enable-ffprobe', '--disable-doc',
    '--disable-debug', '--disable-shared', '--enable-static', '--disable-avdevice',
    '--disable-avfilter', '--disable-postproc', '--disable-encoders', '--disable-muxers',
    '--disable-devices', '--disable-filters', '--disable-network', '--enable-network',
    '--disable-protocols', '--enable-protocol=file,pipe,http,https,tcp,tls',
    '--enable-securetransport', '--disable-videotoolbox', '--disable-audiotoolbox',
    '--disable-iconv', '--disable-zlib', '--disable-bzlib', '--disable-lzma',
    '--disable-sdl2', '--disable-libxcb', '--disable-metal'
  ]
}
function provenanceFor(arch) {
  return { schema: 1, source: SOURCE.url, sourceSha256: SOURCE.sha256, platform: 'darwin', arch, flags: flagsFor(arch) }
}
function verifyBuild(dir, arch) {
  const metadata = JSON.parse(readRegular(path.join(dir, 'ffprobe.build.json')))
  if (JSON.stringify(metadata.provenance) !== JSON.stringify(provenanceFor(arch))) throw new Error('ffprobe source provenance mismatch')
  if (typeof metadata.compiler !== 'string' || !metadata.compiler.includes('clang')) throw new Error('Missing compiler provenance')
  const config = readRegular(path.join(dir, 'ffprobe.config.h'))
  assertDigest(config, metadata.configSha256, 'source configuration')
  const configText = config.toString()
  for (const name of ['GPL', 'NONFREE', 'VERSION3']) {
    if (!new RegExp(`^#define CONFIG_${name} 0$`, 'm').test(configText)) throw new Error(`Unsafe source license configuration: ${name}`)
  }
  if (!/^#define FFMPEG_LICENSE "LGPL version 2.1 or later"$/m.test(configText)) throw new Error('Expected LGPL-2.1-or-later source build')
  const binary = readRegular(path.join(dir, 'ffprobe'))
  assertDigest(binary, metadata.binarySha256, 'local source build ffprobe')
  assertArchitecture(binary, 'darwin', arch)
  // The generated license/configuration strings must also occur in the actual
  // executable, so a stale nonfree release cannot pass with new sidecars alone.
  if (!binary.includes(Buffer.from('LGPL version 2.1 or later')) || binary.includes(Buffer.from('--enable-nonfree')) || !['--disable-gpl', '--disable-nonfree', '--disable-version3', '--disable-autodetect', '--enable-securetransport'].every(flag => binary.includes(Buffer.from(flag)))) {
    throw new Error('Executable does not match LGPL source provenance')
  }
  if (!(fs.statSync(path.join(dir, 'ffprobe')).mode & 0o111)) throw new Error('ffprobe is not executable')
  assertDigest(readRegular(path.join(dir, 'ffprobe.LICENSE')), SOURCE.license, 'LGPL license')
  assertDigest(readRegular(path.join(dir, 'ffprobe.README')), SOURCE.readme, 'source README')
}
function run(command, args, cwd, env, log) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 })
  if (log) fs.appendFileSync(log, `${command} ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}\n`)
  if (result.error || result.status !== 0) throw new Error(`Source build failed: ${command}: ${result.error || (result.stderr || result.stdout || '').slice(-5000)}`)
  return result.stdout.trim()
}
async function build(root, arch, fetch) {
  if (process.platform !== 'darwin') throw new Error('macOS source builds require a macOS host with Apple Command Line Tools')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vectcut-ffprobe-source-'))
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), LC_ALL: 'C', TMPDIR: temp, ZERO_AR_DATE: '1' }
  try {
    const archive = path.join(temp, 'source.tar.xz')
    // Source is user-authorized to build, but must pass the fixed digest before
    // tar/configure/make. Separate empty source and out-of-tree build directories.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { await fetch(SOURCE.url, archive); break } catch (error) {
        fs.rmSync(archive, { force: true })
        if (attempt === 2) throw error
      }
    }
    assertDigest(readRegular(archive), SOURCE.sha256, 'official FFmpeg source')
    const source = path.join(temp, 'source'), buildDir = path.join(temp, 'build')
    fs.mkdirSync(source); fs.mkdirSync(buildDir)
    run('/usr/bin/tar', ['-xf', archive, '-C', source, '--strip-components=1'], temp, env)
    const compiler = run('/usr/bin/clang', ['--version'], buildDir, env)
    const sdk = run('/usr/bin/xcrun', ['--show-sdk-path'], buildDir, env)
    env.SDKROOT = sdk
    const log = path.join(buildDir, 'build.log')
    run('/bin/sh', [path.join(source, 'configure'), ...flagsFor(arch)], buildDir, env, log)
    run('/usr/bin/make', ['-j', String(Math.min(os.cpus().length, 8)), 'ffprobe'], buildDir, env, log)
    const stage = path.join(temp, 'stage'); fs.mkdirSync(stage)
    for (const [src, dst] of [[path.join(buildDir, 'ffprobe'), 'ffprobe'], [path.join(buildDir, 'config.h'), 'ffprobe.config.h'], [path.join(source, 'COPYING.LGPLv2.1'), 'ffprobe.LICENSE'], [path.join(source, 'README.md'), 'ffprobe.README']]) fs.copyFileSync(src, path.join(stage, dst))
    fs.chmodSync(path.join(stage, 'ffprobe'), 0o755)
    fs.writeFileSync(path.join(stage, 'ffprobe.build.json'), JSON.stringify({ provenance: provenanceFor(arch), compiler, sdk, binarySha256: sha256(readRegular(path.join(stage, 'ffprobe'))), configSha256: sha256(readRegular(path.join(stage, 'ffprobe.config.h'))) }, null, 2) + '\n')
    verifyBuild(stage, arch)
    const destination = path.join(root, 'resources', 'ffmpeg', 'darwin', arch)
    fs.mkdirSync(destination, { recursive: true })
    for (const file of fs.readdirSync(stage)) {
      const dst = path.join(destination, file)
      fs.rmSync(dst, { force: true }); fs.copyFileSync(path.join(stage, file), dst)
    }
    fs.chmodSync(path.join(destination, 'ffprobe'), 0o755)
    verifyBuild(destination, arch)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
module.exports = { SOURCE, flagsFor, provenanceFor, verifyBuild, build }
