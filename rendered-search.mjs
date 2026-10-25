import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export function createRenderedSearch(
  root = path.dirname(fileURLToPath(import.meta.url)),
) {
  let queue = Promise.resolve()
  return (queries) => {
    const operation = queue.then(async () => {
      const encoded = Buffer.from(JSON.stringify(queries.slice(0, 2))).toString(
        'base64url',
      )
      let executable = path.join(root, '幻屿.exe'),
        args = ['--public-resource-search', encoded]
      if (!(await stat(executable).catch(() => null))) {
        executable = path.join(
          root,
          'node_modules',
          'electron',
          'dist',
          'electron.exe',
        )
        args = [path.join(root, 'desktop', 'search-entry.cjs'), encoded]
      }
      if (!(await stat(executable).catch(() => null)))
        throw new Error('网页搜索需要幻屿桌面版，请使用来源网站查找')
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const { stdout } = await promisify(execFile)(executable, args, {
        cwd: root,
        windowsHide: true,
        timeout: 58000,
        maxBuffer: 512 * 1024,
        env,
      })
      const line = stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith('YINGYU_SEARCH_RESULT='))
      if (!line) throw new Error('网页搜索暂时不可用')
      return JSON.parse(line.slice('YINGYU_SEARCH_RESULT='.length))
    })
    queue = operation.catch(() => {})
    return operation
  }
}
