import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cp, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

// Keep installation payloads separate from the working desktop app and its data.
const root = path.dirname(fileURLToPath(import.meta.url))
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
const output = path.resolve(process.env.HUANYU_INSTALLER_OUTPUT || path.join(root, 'release', 'installer'))
const compiler = process.env.INNO_SETUP_COMPILER || path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe')
await stat(compiler)
await stat(path.join(root, 'dist', 'index.html'))
const staging = await mkdtemp(path.join(root, 'installer', 'package-'))
await mkdir(output, { recursive: true })

// Build the current desktop entry point into a clean payload, never an installed app's data.
execFileSync(process.execPath, [path.join(root, 'package-desktop.mjs')], {
  cwd: root,
  env: { ...process.env, YINGYU_PACKAGE_DIR: staging },
  stdio: 'inherit',
  windowsHide: true,
})
execFileSync(process.execPath, [path.join(root, 'package-portable.mjs')], {
  cwd: root,
  env: { ...process.env, YINGYU_PACKAGE_DIR: staging },
  stdio: 'inherit',
  windowsHide: true,
})
for (const file of ['幻屿.exe', 'resources/app.asar', 'dist/index.html', 'server.mjs', 'games.mjs', 'app-data.mjs', 'game-resources.mjs', 'movie-catalog.mjs', 'movie-filters.mjs', 'movie-seed.json', 'web-sources.mjs', 'runtime/node.exe', 'runtime/ffmpeg.exe', 'runtime/ffprobe.exe']) {
  await stat(path.join(staging, file))
}
createRequire(path.join(staging, 'server.mjs')).resolve('mp4box')
console.log(`已验证完整安装源：${staging}`)
execFileSync(compiler, [`/DAppSourceDir=${staging}`, `/DPackageOutputDir=${output}`, path.join(root, 'installer', '幻屿.iss')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})
await cp(path.join(output, `幻屿-${version}-安装程序.exe`), path.join(output, `Huanyu-${version}-Setup.exe`))
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'installer', 'build-zip.ps1'), '-SourceDirectory', staging, '-DestinationPath', path.join(output, `Huanyu-${version}-Portable.zip`)], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})
await cp(path.join(output, `Huanyu-${version}-Portable.zip`), path.join(output, `幻屿-${version}-便携版.zip`))
console.log(`安装包已生成：${output}`)
