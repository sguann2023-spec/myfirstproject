const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const hooks = require('./ffmpeg-builder-hooks')
const root = path.resolve(__dirname, '..')
test('packaging rejects missing bundled FFmpeg before packing', async t => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(),'ffmpeg-hooks-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}))
 await assert.rejects(hooks.beforePack({electronPlatformName:'win32',arch:1,packager:{projectDir:temp}}),/Missing bundled FFmpeg/)
})
for (const platform of ['darwin','win32']) {
 test(`checks source and packaged binary for ${platform}`, async t => {
  const arches=platform==='darwin'?['x64','arm64']:['x64'];const name=platform==='win32'?'ffmpeg.exe':'ffmpeg'
  if(arches.some(a=>!fs.existsSync(path.join(root,'resources/ffmpeg',platform,a,name)))){t.skip('target files not prepared');return}
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ffmpeg-hooks-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}))
  const c={electronPlatformName:platform,arch:platform==='darwin'?3:1,appOutDir:temp,packager:{projectDir:root,appInfo:{productFilename:'Test'}}}
  await hooks.beforePack(c)
  await assert.rejects(hooks.afterPack(c),/Missing bundled FFmpeg/)
  const base=platform==='darwin'?path.join(temp,'Test.app/Contents/Resources/resources/ffmpeg/darwin'):path.join(temp,'resources/resources/ffmpeg/win32')
  for(const a of arches){fs.mkdirSync(path.join(base,a),{recursive:true});fs.copyFileSync(path.join(root,'resources/ffmpeg',platform,a,name),path.join(base,a,name))}
  await hooks.afterPack(c)
  fs.writeFileSync(path.join(base,arches[0],name),'corrupt')
  await assert.rejects(hooks.afterPack(c),/SHA256/)
 })
}
test('universal config exempts the intended same-arch copies of both executables',()=>{
 const cfg=require('../electron-builder.config.cjs')
 assert.match(cfg.mac.x64ArchFiles,/ffprobe\/darwin/)
 assert.match(cfg.mac.x64ArchFiles,/resources\/ffmpeg\/darwin/)
})
test('electron-builder executes both tool hooks in order',async()=>{
 const vm=require('node:vm');const calls=[];const mod={exports:{}}
 const fake={beforePack:async()=>calls.push('probe-before'),afterPack:async()=>calls.push('probe-after')}
 const fakeF={beforePack:async()=>calls.push('mpeg-before'),afterPack:async()=>calls.push('mpeg-after')}
 vm.runInNewContext(fs.readFileSync(path.join(root,'electron-builder.config.cjs'),'utf8'),{module:mod,require(name){
  if(name==='./package.json')return require('../package.json')
  if(name==='./channel-branding/index.cjs')return require('../channel-branding/index.cjs')
  if(name==='./util/ffprobe-builder-hooks')return fake
  if(name==='./util/ffmpeg-builder-hooks')return fakeF
  throw new Error(name)
 }})
 await mod.exports.beforePack({});await mod.exports.afterPack({})
 assert.deepEqual(calls,['probe-before','mpeg-before','probe-after','mpeg-after'])
})
