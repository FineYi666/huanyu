import { packager } from '@electron/packager'
import path from 'node:path'
import { readFile, cp, mkdir, readdir } from 'node:fs/promises'
const root = process.cwd()
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const output =
  process.env.YINGYU_PACKAGE_DIR ||
  path.join(root, 'release', `幻屿-${version}-Windows-x64`)
const paths = await packager({
  dir: path.join(root, 'desktop'),
  name: '幻屿',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '45.0.0',
  out: path.join(root, 'release', 'native-build'),
  overwrite: true,
  asar: true,
  prune: false,
  icon: path.join(root, 'public', 'yingyu.ico'),
  appVersion: version,
  appCopyright: '幻屿 · Your private cinema',
  win32metadata: {
    CompanyName: '幻屿',
    FileDescription: '幻屿私人放映室',
    ProductName: '幻屿',
    InternalName: 'YingyuCinema',
  },
})
await mkdir(output, { recursive: true })
for (const entry of await readdir(paths[0]))
  await cp(path.join(paths[0], entry), path.join(output, entry), {
    recursive: true,
  })
console.log(`独立桌面端已准备：${output}`)
