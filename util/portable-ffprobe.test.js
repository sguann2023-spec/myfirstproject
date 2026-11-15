const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sha256, assertDigest, architectures, assertArchitecture } = require('./ffprobe-integrity')
const { TARGETS, parseArgs, prepareTarget, verifyDirectory, targetDir } = require('./prepare-portable-ffprobe')
const hooks = require('./ffprobe-builder-hooks')
function thin(arch, le = true) {
  const data = Buffer.alloc(64)
  const write = (n, at) => le ? data.writeUInt32LE(n, at) : data.writeUInt32BE(n, at)
  write(0xfeedfacf, 0)
  write(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
  write(2, 12)
  return data
}
function fat(fat64 = false, le = false) {
  const data = Buffer.alloc(256)
  const write = (n, at) => le ? data.writeUInt32LE(n, at) : data.writeUInt32BE(n, at)
  write(fat64 ? 0xcafebabf : 0xcafebabe, 0)
  write(2, 4)
  for (let i = 0; i < 2; i++) {
    const entry = 8 + i * (fat64 ? 32 : 20)
    write(i === 0 ? 0x01000007 : 0x0100000c, entry)
    if (fat64) {
      const method = le ? 'writeBigUInt64LE' : 'writeBigUInt64BE'
      data[method](BigInt(128 + 64 * i), entry + 8)
      data[method](64n, entry + 16)
    } else { write(128 + 64 * i, entry + 8); write(64, entry + 12) }
    thin(i === 0 ? 'x64' : 'arm64').copy(data, 128 + i * 64)
  }
  return data
}
function pe() {
  const data = Buffer.alloc(256)
  data.write('MZ'); data.writeUInt32LE(128, 0x3c)
  data.writeUInt32LE(0x4550, 128); data.writeUInt16LE(0x8664, 132)
  data.writeUInt16LE(0x20b, 152)
  return data
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffprobe-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
// Exercise real validators without downloading release bytes. Only pinned hashes
// are replaced with deterministic fixture hashes; all integrity checks stay real.
function fixtureModules() {
  const vm = require('node:vm')
  const license = Buffer.from('fixture license\n'), readme = Buffer.from('fixture README\n')
  function load(name, dependencies = {}, transform = text => text) {
    const filename = path.join(__dirname, name)
    const module = { exports: {} }
    vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), {
      module, exports: module.exports, Buffer, process, console, __dirname,
      require: id => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id)
    }, { filename })
    return module.exports
  }
  const source = load('ffprobe-source-build.js', {}, text => text
    .replace(/license: '[a-f0-9]{64}'/, `license: '${sha256(license)}'`)
    .replace(/readme: '[a-f0-9]{64}'/, `readme: '${sha256(readme)}'`))
  const prepare = load('prepare-portable-ffprobe.js', { './ffprobe-source-build': source }, text => text
    .replace(/binary: '[a-f0-9]{64}'/, `binary: '${sha256(pe())}'`)
    .replace(/license: '[a-f0-9]{64}'/, `license: '${sha256(license)}'`)
    .replace(/readme: '[a-f0-9]{64}'/, `readme: '${sha256(readme)}'`))
  const builder = load('ffprobe-builder-hooks.js', { './prepare-portable-ffprobe': prepare })
  function write(dir, platform, arch, sidecarDir = dir) {
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(sidecarDir, { recursive: true })
    const binary = platform === 'win32' ? pe() : Buffer.concat([thin(arch), Buffer.from([
      'LGPL version 2.1 or later', '--disable-gpl', '--disable-nonfree',
      '--disable-version3', '--disable-autodetect', '--enable-securetransport'
    ].join('\0'))])
    fs.writeFileSync(path.join(dir, prepare.binaryName(platform)), binary, { mode: 0o755 })
    fs.writeFileSync(path.join(sidecarDir, 'ffprobe.LICENSE'), license)
    fs.writeFileSync(path.join(sidecarDir, 'ffprobe.README'), readme)
    if (platform === 'darwin') {
      const config = Buffer.from('#define CONFIG_GPL 0\n#define CONFIG_NONFREE 0\n#define CONFIG_VERSION3 0\n#define FFMPEG_LICENSE "LGPL version 2.1 or later"\n')
      fs.writeFileSync(path.join(sidecarDir, 'ffprobe.config.h'), config)
      fs.writeFileSync(path.join(sidecarDir, 'ffprobe.build.json'), JSON.stringify({
        provenance: source.provenanceFor(arch), compiler: 'fixture clang',
        binarySha256: sha256(binary), configSha256: sha256(config)
      }))
    }
  }
  return { source, prepare, builder, write }
}
test('SHA256 rejects tampering', () => {
  assertDigest(Buffer.from('abc'), sha256(Buffer.from('abc')), 'fixture')
  assert.throws(() => assertDigest(Buffer.from('abd'), sha256(Buffer.from('abc')), 'fixture'), /SHA256/)
})
test('Mach-O thin little/big endian and wrong architecture', () => {
  for (const le of [true, false]) for (const arch of ['arm64', 'x64']) assertArchitecture(thin(arch, le), 'darwin', arch)
  assert.throws(() => assertArchitecture(thin('x64'), 'darwin', 'arm64'), /Architecture mismatch/)
})
test('Mach-O fat32/fat64 and endian variants validate embedded slices', () => {
  for (const wide of [true, false]) for (const le of [true, false]) assertArchitecture(fat(wide, le), 'darwin', 'universal')
  assert.throws(() => assertArchitecture(fat(), 'darwin', 'arm64'), /Architecture mismatch/)
  const bad = fat(); bad.writeUInt32LE(0x01000007, 196)
  assert.throws(() => architectures(bad, 'darwin'), /CPU table/)
})
test('reject malformed fat ranges/count and truncated executables', () => {
  const overlap = fat(); overlap.writeUInt32BE(128, 36)
  assert.throws(() => architectures(overlap, 'darwin'), /Overlapping/)
  const count = fat(); count.writeUInt32BE(20, 4)
  assert.throws(() => architectures(count, 'darwin'), /count/)
  for (const buf of [Buffer.alloc(0), Buffer.alloc(4), thin('arm64').subarray(0, 16)]) {
    assert.throws(() => architectures(buf, 'darwin'))
  }
})
test('Windows PE x64 and rejection of bad signature/machine/PE32', () => {
  assertArchitecture(pe(), 'win32', 'x64')
  for (const [at, value] of [[132, 0xaa64], [152, 0x10b], [128, 0]]) {
    const bad = pe(); bad.writeUInt16LE(value, at)
    assert.throws(() => architectures(bad, 'win32'))
  }
})
test('CLI strictly validates targets, flags, missing values, cross smoke', () => {
  assert.deepEqual(parseArgs(['--target-platform', 'darwin']).arches, ['x64', 'arm64'])
  assert.equal(parseArgs(['--check-only']).checkOnly, true)
  for (const args of [['--bogus'], ['--root'], ['--target-platform', 'linux'], ['--target-platform', 'win32', '--target-arches', 'arm64'], ['--target-platform', 'darwin', '--target-arches', '']]) {
    assert.throws(() => parseArgs(args))
  }
  const other = process.platform === 'win32' ? 'darwin' : 'win32'
  assert.throws(() => parseArgs(['--smoke-test', '--target-platform', other]), /native/)
})
test('check-only is offline and does not create missing directories', async t => {
  const root = temp(t)
  await assert.rejects(prepareTarget(root, 'darwin', 'arm64', { checkOnly: true, fetch: () => assert.fail('network') }))
  assert.deepEqual(fs.readdirSync(root), [])
})
test('cached binary and forged metadata are independently digest-checked', async t => {
  const root = temp(t), dir = targetDir(root, 'darwin', 'arm64')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ffprobe'), thin('arm64'))
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(TARGETS['darwin/arm64']))
  await assert.rejects(prepareTarget(root, 'darwin', 'arm64', { checkOnly: true }), /ffprobe.build.json/)
})
test('bad downloaded gzip rejected before decompress/execute and temp cleaned', async t => {
  const root = temp(t)
  let downloaded
  await assert.rejects(prepareTarget(root, 'win32', 'x64', { fetch: async (url, file) => {
    downloaded = file; fs.writeFileSync(file, 'untrusted')
  } }), /SHA256/)
  assert.equal(fs.existsSync(path.dirname(downloaded)), false)
  assert.equal(fs.existsSync(targetDir(root, 'win32', 'x64')), false)
})
test('builder rejects missing/tampered inputs and unsupported Windows arch', async t => {
  const root = temp(t)
  const context = { electronPlatformName: 'darwin', arch: 3, packager: { projectDir: root, appInfo: { productFilename: 'Test' } }, appOutDir: root }
  assert.deepEqual(hooks.archesFor(context), ['x64', 'arm64'])
  await assert.rejects(hooks.beforePack(context))
  await assert.rejects(hooks.afterPack(context))
  assert.throws(() => hooks.archesFor({ ...context, electronPlatformName: 'win32' }), /Only win32/)
  assert.equal(hooks.packagedDir(context, 'arm64'), path.join(root, 'Test.app', 'Contents', 'Frameworks', 'ffprobe', 'darwin', 'arm64'))
})
test('builder config removes old mappings and allows identical universal copies', () => {
  const config = require('../electron-builder.config.cjs')
  assert.equal(JSON.stringify(config.extraResources).includes('ffprobe-static'), false)
  assert.equal(JSON.stringify(config.mac.extraFiles).includes('ffprobe-static'), false)
  assert.match(config.mac.x64ArchFiles, /ffprobe\/darwin/)
  // Hooks are composed with FFmpeg checks; don't require function identity.
  assert.equal(typeof config.beforePack, 'function')
  assert.equal(typeof config.afterPack, 'function')
  assert.match(config.mac.x64ArchFiles, /resources\/ffmpeg\/darwin/)
})
test('builder removes legacy and new ffprobe mappings but preserves unrelated files', () => {
  const vm = require('node:vm')
  const configPath = path.resolve(__dirname, '../electron-builder.config.cjs')
  const pkg = JSON.parse(JSON.stringify(require('../package.json')))
  const old = { from: 'node_modules/ffprobe-static/bin/darwin/${arch}', to: 'Frameworks/ffprobe/darwin/${arch}', filter: ['ffprobe'] }
  const mac = { from: 'resources/ffmpeg/darwin/${arch}', to: 'Frameworks/ffprobe/darwin/${arch}', filter: ['ffprobe'] }
  const win = { from: 'resources/ffmpeg/win32/x64', to: 'ffprobe/win32/x64', filter: ['ffprobe.exe'] }
  const unrelated = { from: 'resources/ffmpeg/darwin/${arch}', to: 'Frameworks/ffmpeg', filter: ['ffmpeg'] }
  pkg.build.mac.extraFiles = [old, mac, unrelated, 'other-extra-file']
  pkg.build.extraResources.push(win)
  pkg.build.win.extraResources.push({ from: 'other-source', to: 'ffprobe/win32/x64' })
  pkg.build.extraFiles = [{ from: 'resources/ffmpeg/win32/x64', to: 'tools', filter: ['ffprobe.exe'] }]
  const result = { exports: {} }
  vm.runInNewContext(fs.readFileSync(configPath, 'utf8'), {
    module: result,
    require: id => id === './package.json' ? pkg : require(path.resolve(path.dirname(configPath), id))
  }, { filename: configPath })
  const config = result.exports
  assert.equal(config.mac.extraFiles.length, 2)
  assert.equal(JSON.stringify(config.mac.extraFiles[0]), JSON.stringify(unrelated))
  assert.equal(config.mac.extraFiles[1], 'other-extra-file')
  assert.equal(config.extraFiles.length, 0)
  for (const entries of [config.extraResources, config.mac.extraFiles, config.win.extraResources]) {
    assert.equal(entries.some(entry => typeof entry === 'object' && /(^|\/)ffprobe\//.test(entry.to || '')), false)
  }
  // Also check the actual package.json-derived config, not only injected fixtures.
  const actual = require('../electron-builder.config.cjs')
  assert.equal(actual.extraResources.some(entry => entry.to === 'ffprobe/win32/x64'), false)
  assert.equal(actual.mac.extraFiles.some(entry => String(entry.to).includes('Frameworks/ffprobe/')), false)
})
test('source flags pin LGPL-only build and provenance rejects old sources/flags', t => {
  const source = require('./ffprobe-source-build')
  for (const arch of ['arm64', 'x64']) {
    const flags = source.flagsFor(arch)
    for (const flag of ['--disable-gpl', '--disable-nonfree', '--disable-version3', '--disable-autodetect', '--enable-securetransport']) assert.ok(flags.includes(flag))
  }
  const dir = temp(t)
  const metadata = { provenance: { ...source.provenanceFor('arm64'), sourceSha256: '0'.repeat(64) } }
  fs.writeFileSync(path.join(dir, 'ffprobe.build.json'), JSON.stringify(metadata))
  assert.throws(() => source.verifyBuild(dir, 'arm64'), /provenance/)
  metadata.provenance = source.provenanceFor('arm64')
  metadata.provenance.flags = ['--enable-nonfree']
  fs.writeFileSync(path.join(dir, 'ffprobe.build.json'), JSON.stringify(metadata))
  assert.throws(() => source.verifyBuild(dir, 'arm64'), /provenance/)
})
test('source validation accepts colocated caches and split packaged sidecars', t => {
  const { source, prepare, write } = fixtureModules()
  const root = temp(t)
  for (const arch of ['x64', 'arm64']) {
    const dir = path.join(root, arch), sidecars = path.join(root, `${arch}-sidecars`)
    write(dir, 'darwin', arch)
    source.verifyBuild(dir, arch)
    prepare.verifyDirectory(dir, 'darwin', arch)
    for (const name of fs.readdirSync(dir).filter(name => name !== 'ffprobe')) {
      fs.mkdirSync(sidecars, { recursive: true })
      fs.renameSync(path.join(dir, name), path.join(sidecars, name))
    }
    source.verifyBuild(dir, arch, sidecars)
    prepare.verifyDirectory(dir, 'darwin', arch, sidecars)
    assert.throws(() => prepare.verifyDirectory(dir, 'darwin', arch), /ffprobe.build.json/)
    assert.deepEqual(fs.readdirSync(dir), ['ffprobe'])
  }
})
test('split source validation rejects missing and tampered files without fallback', t => {
  const { source, prepare, write } = fixtureModules()
  const root = temp(t)
  const names = ['ffprobe.build.json', 'ffprobe.config.h', 'ffprobe.LICENSE', 'ffprobe.README', 'ffprobe']
  for (const arch of ['x64', 'arm64']) for (const name of names) for (const missing of [true, false]) {
    const base = path.join(root, `${arch}-${name}-${missing}`)
    const dir = path.join(base, 'binary'), sidecars = path.join(base, 'sidecars')
    write(dir, 'darwin', arch, sidecars)
    // Valid misplaced copies must not mask damage at the authoritative location.
    for (const file of names) {
      const from = file === 'ffprobe' ? dir : sidecars
      fs.copyFileSync(path.join(from, file), path.join(file === 'ffprobe' ? sidecars : dir, file))
    }
    const file = path.join(name === 'ffprobe' ? dir : sidecars, name)
    if (missing) fs.unlinkSync(file)
    else if (name === 'ffprobe.build.json') {
      const metadata = JSON.parse(fs.readFileSync(file))
      metadata.provenance.sourceSha256 = '0'.repeat(64)
      fs.writeFileSync(file, JSON.stringify(metadata))
    } else fs.appendFileSync(file, 'tampered')
    const label = `${arch} ${missing ? 'missing' : 'tampered'} ${name}`
    assert.throws(() => source.verifyBuild(dir, arch, sidecars), undefined, label)
    assert.throws(() => prepare.verifyDirectory(dir, 'darwin', arch, sidecars), undefined, label)
  }
})
test('split source validation checks architecture independently of binary digest', t => {
  const { source, prepare, write } = fixtureModules()
  const root = temp(t)
  for (const arch of ['x64', 'arm64']) {
    const dir = path.join(root, arch), sidecars = path.join(root, `${arch}-sidecars`)
    write(dir, 'darwin', arch, sidecars)
    const file = path.join(dir, 'ffprobe'), binary = fs.readFileSync(file)
    thin(arch === 'x64' ? 'arm64' : 'x64').copy(binary)
    fs.writeFileSync(file, binary)
    const metaPath = path.join(sidecars, 'ffprobe.build.json')
    const metadata = JSON.parse(fs.readFileSync(metaPath))
    metadata.binarySha256 = sha256(binary)
    fs.writeFileSync(metaPath, JSON.stringify(metadata))
    assert.throws(() => source.verifyBuild(dir, arch, sidecars), /Architecture mismatch/)
    assert.throws(() => prepare.verifyDirectory(dir, 'darwin', arch, sidecars), /Architecture mismatch/)
  }
})
test('Mac x64 and arm64 staging split sidecars; universal validates without writes', async t => {
  const { prepare, builder, write } = fixtureModules()
  const root = temp(t)
  for (const arch of ['x64', 'arm64']) write(prepare.targetDir(root, 'darwin', arch), 'darwin', arch)
  const context = { electronPlatformName: 'darwin', arch: 1, appOutDir: path.join(root, 'out'), packager: { projectDir: root, appInfo: { productFilename: 'Test' } } }
  const sidecarNames = ['ffprobe.LICENSE', 'ffprobe.README', 'ffprobe.build.json', 'ffprobe.config.h'].sort()
  const snapshots = []
  for (const stagingArch of [1, 3]) {
    const staging = { ...context, arch: stagingArch, appOutDir: path.join(root, `out-${stagingArch}`) }
    await builder.beforePack(staging); await builder.afterPack(staging)
    const snapshot = []
    for (const arch of ['x64', 'arm64']) {
      const dir = builder.packagedDir(staging, arch), sidecars = builder.packagedSidecarDir(staging, arch)
      assert.equal(dir, path.join(staging.appOutDir, 'Test.app', 'Contents', 'Frameworks', 'ffprobe', 'darwin', arch))
      assert.equal(sidecars, path.join(staging.appOutDir, 'Test.app', 'Contents', 'Resources', 'ffprobe', 'darwin', arch))
      assert.deepEqual(fs.readdirSync(dir), ['ffprobe'])
      assert.deepEqual(fs.readdirSync(sidecars).sort(), sidecarNames)
      prepare.verifyDirectory(dir, 'darwin', arch, sidecars)
      for (const [folder, names] of [[dir, ['ffprobe']], [sidecars, sidecarNames]]) {
        for (const name of names) snapshot.push({ file: path.join(folder, name), bytes: fs.readFileSync(path.join(folder, name)) })
      }
    }
    snapshots.push(snapshot.map(entry => entry.bytes))
    for (const arch of [4, 'universal']) await builder.afterPack({ ...staging, arch })
    for (const entry of snapshot) assert.deepEqual(fs.readFileSync(entry.file), entry.bytes)
    const metadata = path.join(builder.packagedSidecarDir(staging, 'arm64'), 'ffprobe.build.json')
    fs.unlinkSync(metadata)
    await assert.rejects(builder.afterPack({ ...staging, arch: 4 }), /ffprobe.build.json/)
    assert.equal(fs.existsSync(metadata), false, 'universal validation must not repair sidecars')
  }
  assert.deepEqual(snapshots[0], snapshots[1], 'universal input trees contain identical bytes')
})
test('Windows packaging keeps binary and sidecars together with pinned validation', async t => {
  const { prepare, builder, write } = fixtureModules()
  const root = temp(t), source = prepare.targetDir(root, 'win32', 'x64')
  write(source, 'win32', 'x64')
  const context = { electronPlatformName: 'win32', arch: 1, appOutDir: path.join(root, 'out'), packager: { projectDir: root, appInfo: { productFilename: 'Test' } } }
  await builder.beforePack(context); await builder.afterPack(context)
  const dir = builder.packagedDir(context, 'x64')
  assert.equal(dir, path.join(context.appOutDir, 'resources', 'ffprobe', 'win32', 'x64'))
  assert.equal(builder.packagedSidecarDir(context, 'x64'), dir)
  assert.deepEqual(fs.readdirSync(dir).sort(), ['ffprobe.LICENSE', 'ffprobe.README', 'ffprobe.exe'])
  prepare.verifyDirectory(dir, 'win32', 'x64')
  for (const name of ['ffprobe.exe', 'ffprobe.LICENSE', 'ffprobe.README']) {
    const file = path.join(dir, name), bytes = fs.readFileSync(file)
    fs.appendFileSync(file, 'tampered')
    assert.throws(() => prepare.verifyDirectory(dir, 'win32', 'x64'), /SHA256/)
    await assert.rejects(builder.afterPack(context), /SHA256/)
    fs.unlinkSync(file)
    assert.throws(() => prepare.verifyDirectory(dir, 'win32', 'x64'))
    fs.writeFileSync(file, bytes)
  }
})
// Opt-in real release integration: never download/execute fixtures in unit tests.
test('verified source macOS and release Windows packaging plus universal pre-sign validation', { skip: !process.env.FFPROBE_INTEGRATION_ROOT }, async t => {
  const root = process.env.FFPROBE_INTEGRATION_ROOT, output = temp(t)
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) verifyDirectory(targetDir(root, platform, arch), platform, arch)
  const context = { electronPlatformName: 'darwin', arch: 1, appOutDir: output, packager: { projectDir: root, appInfo: { productFilename: 'Test' } } }
  await hooks.beforePack(context); await hooks.afterPack(context)
  await hooks.afterPack({ ...context, arch: 4 })
  const staged = hooks.packagedDir(context, 'arm64')
  const metaPath = path.join(hooks.packagedSidecarDir(context, 'arm64'), 'ffprobe.build.json')
  const metadata = JSON.parse(fs.readFileSync(metaPath))
  metadata.provenance.sourceSha256 = '0'.repeat(64)
  fs.writeFileSync(metaPath, JSON.stringify(metadata))
  await assert.rejects(hooks.afterPack({ ...context, arch: 4 }), /provenance/)
  fs.copyFileSync(path.join(targetDir(root, 'darwin', 'arm64'), 'ffprobe.build.json'), metaPath)
  fs.writeFileSync(path.join(staged, 'ffprobe'), thin('arm64'))
  await assert.rejects(hooks.afterPack({ ...context, arch: 4 }), /SHA256/)
  const win = { ...context, electronPlatformName: 'win32', appOutDir: path.join(output, 'win') }
  await hooks.beforePack(win); await hooks.afterPack(win)
  verifyDirectory(hooks.packagedDir(win, 'x64'), 'win32', 'x64')
})
