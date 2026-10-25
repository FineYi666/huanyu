import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'

const root = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('此打包脚本需要 Windows x64 的 Node.js 环境')
const version = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
).version
const out =
  process.env.YINGYU_PACKAGE_DIR ||
  path.join(root, 'release', `幻屿-${version}-Windows-x64`)
await stat(path.join(root, 'dist', 'index.html'))
await mkdir(path.join(out, 'runtime'), { recursive: true })
await cp(path.join(root, 'dist'), path.join(out, 'dist'), { recursive: true })
for (const file of [
  'server.mjs',
  'media-utils.mjs',
  'local-browser.mjs',
  'quark.mjs',
  'media-category.mjs',
  'resource-search.mjs',
  'rendered-search.mjs',
  'video-stream.mjs',
  'subtitles.mjs',
  'subtitle-service.mjs',
  'subtitle-style.mjs',
  'embedded-subtitles.mjs',
  'mp4-subtitles.mjs',
  'replace-source.mjs',
  'quark-login.mjs',
  'appearance.mjs',
  'metadata.mjs',
  'metadata-jobs.mjs',
  'secret-store.mjs',
  'seasonal.mjs',
  'poster-cache.mjs',
  'seasonal-metadata.mjs',
  'seasonal.json',
  'catalog.json',
  'launch.mjs',
  'stop.mjs',
  '启动幻屿.cmd',
  '关闭幻屿.cmd',
  '启动幻屿.vbs',
  '创建桌面快捷方式.ps1',
  '创建桌面快捷方式.cmd',
  'README.md',
  'ICON-PROMPT.md',
  'SCENE-ASSETS.md',
])
  await cp(path.join(root, file), path.join(out, file))
await cp(process.execPath, path.join(out, 'runtime', 'node.exe'))
await cp(require('ffmpeg-static'),path.join(out,'runtime','ffmpeg.exe'))
await cp(require('ffprobe-static').path,path.join(out,'runtime','ffprobe.exe'))
await cp(path.join(root,'node_modules','mp4box'),path.join(out,'node_modules','mp4box'),{recursive:true})
for(const file of ['ffmpeg.exe.LICENSE','ffmpeg.exe.README'])await cp(path.join(root,'node_modules','ffmpeg-static',file),path.join(out,'runtime',file))
await cp(path.join(root,'node_modules','ffprobe-static','LICENSE'),path.join(out,'runtime','ffprobe.LICENSE'))
let notices = '幻屿 - Third-party software notices\n\n'
notices += '\nFFmpeg / FFprobe are separate GPL executables used for local subtitle demuxing. Build information, license and source references are provided in runtime/ffmpeg.exe.README and runtime/ffmpeg.exe.LICENSE. Upstream: https://ffmpeg.org/ ; binaries: https://github.com/eugeneware/ffmpeg-static ; Windows source builds: https://www.gyan.dev/ffmpeg/builds/ .\n'
notices +=
  '\n==================== qrcode-generator 2.0.4 (MIT) ====================\n\n' +
  (await readFile(
    path.join(root, 'licenses', 'QRCODE-GENERATOR-LICENSE.txt'),
    'utf8',
  ))
for (const name of [
  'react',
  'react-dom',
  'scheduler',
  'lucide-react',
  'hls.js',
  '@fontsource-variable/geist',
  'vite',
  'mp4box',
]) {
  const base = name==='mp4box' ? path.join(root,'node_modules','mp4box') : path.dirname(require.resolve(`${name}/package.json`))
  const metadata = JSON.parse(
    await readFile(path.join(base, 'package.json'), 'utf8'),
  )
  notices += `\n==================== ${name} ${metadata.version} ====================\n\n`
  let found = false
  for (const file of [
    'LICENSE',
    'LICENSE.txt',
    'LICENSE.md',
    'license',
    'OFL.txt',
    'OFL.md',
  ]) {
    try {
      notices += await readFile(path.join(base, file), 'utf8')
      found = true
      break
    } catch {}
  }
  if (!found) throw new Error(`没有找到 ${name} 的许可证，请手动确认再打包`)
  notices += '\n'
}
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE')
notices += `\n==================== Node.js ${process.version} ====================\n\n`
try {
  notices += await readFile(nodeLicense, 'utf8')
} catch {
  notices += await readFile(
    path.join(root, 'licenses', 'NODE-LICENSE.txt'),
    'utf8',
  )
}
await writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices)
console.log(`便携版文件已准备：${out}`)
