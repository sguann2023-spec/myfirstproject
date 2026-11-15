const fs = require('node:fs')
const crypto = require('node:crypto')

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function assertDigest(data, expected, label) {
  if (!/^[a-f0-9]{64}$/.test(expected) || sha256(data) !== expected) {
    throw new Error(`SHA256 mismatch: ${label}`)
  }
}

// Parse bytes, not filenames or sidecar metadata. Fat slices are checked against
// their own thin headers as well as the outer CPU table (including fat64).
function architectures(data, platform) {
  function need(offset, size) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > data.length) {
      throw new Error('Truncated or invalid executable header')
    }
  }
  need(0, 4)
  if (platform === 'win32') {
    need(0, 64)
    if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Expected Windows PE')
    const offset = data.readUInt32LE(0x3c)
    need(offset, 26)
    if (data.readUInt32LE(offset) !== 0x4550 || data.readUInt16LE(offset + 24) !== 0x20b) {
      throw new Error('Expected PE32+ executable')
    }
    const machine = data.readUInt16LE(offset + 4)
    if (machine !== 0x8664) throw new Error('Unsupported PE machine')
    return ['x64']
  }
  if (platform !== 'darwin') throw new Error(`Unsupported platform: ${platform}`)
  function cpu(value) {
    if (value === 0x01000007) return 'x64'
    if (value === 0x0100000c) return 'arm64'
    throw new Error('Unsupported Mach-O CPU')
  }
  function thin(offset, size) {
    need(offset, 32)
    if (size < 32) throw new Error('Truncated Mach-O slice')
    const magic = data.readUInt32BE(offset)
    const read = magic === 0xcffaedfe
      ? (at) => data.readUInt32LE(at)
      : magic === 0xfeedfacf ? (at) => data.readUInt32BE(at) : null
    if (!read || read(offset + 12) !== 2) throw new Error('Expected 64-bit Mach-O executable')
    return cpu(read(offset + 4))
  }
  const magic = data.readUInt32BE(0)
  const fat64 = magic === 0xcafebabf || magic === 0xbfbafeca
  const fat = fat64 || magic === 0xcafebabe || magic === 0xbebafeca
  if (!fat) return [thin(0, data.length)]
  const le = magic === 0xbebafeca || magic === 0xbfbafeca
  const read = (at) => le ? data.readUInt32LE(at) : data.readUInt32BE(at)
  const read64 = (at) => Number(le ? data.readBigUInt64LE(at) : data.readBigUInt64BE(at))
  need(0, 8)
  const count = read(4)
  if (count < 1 || count > 16) throw new Error('Invalid Mach-O fat slice count')
  const stride = fat64 ? 32 : 20
  const headerEnd = 8 + count * stride
  need(0, headerEnd)
  const ranges = []
  const result = []
  for (let i = 0; i < count; i += 1) {
    const entry = 8 + i * stride
    const arch = cpu(read(entry))
    const offset = fat64 ? read64(entry + 8) : read(entry + 8)
    const size = fat64 ? read64(entry + 16) : read(entry + 12)
    need(offset, size)
    if (offset < headerEnd || ranges.some(([a, b]) => offset < b && offset + size > a)) {
      throw new Error('Overlapping Mach-O slices')
    }
    if (thin(offset, size) !== arch || result.includes(arch)) throw new Error('Invalid Mach-O fat CPU table')
    ranges.push([offset, offset + size])
    result.push(arch)
  }
  return result.sort()
}

function assertArchitecture(data, platform, arch) {
  const actual = architectures(data, platform)
  const wanted = arch === 'universal' && platform === 'darwin' ? ['arm64', 'x64'] : [arch]
  if (actual.join(',') !== wanted.join(',')) {
    throw new Error(`Architecture mismatch: expected ${platform}/${arch}, got ${actual.join(',')}`)
  }
}

function readRegular(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected regular file: ${file}`)
  return fs.readFileSync(file)
}

module.exports = { sha256, assertDigest, architectures, assertArchitecture, readRegular }
