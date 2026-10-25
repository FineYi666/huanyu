import path from 'node:path'
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'

function transformSecret(value, decrypt = false) {
  if (process.platform !== 'win32')
    throw new Error(
      '此版本的密钥加密存储需要 Windows；请在 Windows 版幻屿中绑定',
    )
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); ${
    decrypt
      ? '$b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($r))'
      : '$b=[Text.Encoding]::UTF8.GetBytes($v); $r=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))'
  }`
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('本机密钥加密服务超时，请重试'))
    }, 12000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.resume()
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('无法启动本机密钥加密服务'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 && output
        ? resolve(output)
        : reject(
            new Error('无法读取或保存密钥，请在当前 Windows 账号下重新绑定'),
          )
    })
    child.stdin.on('error', () => {})
    child.stdin.end(value)
  })
}

export function createSecretStore(directory, name = 'deepseek.key') {
  if (!/^[a-z0-9-]+\.key$/.test(name)) throw new Error('密钥存储名称不正确')
  const file = path.join(directory, name)
  let pending = Promise.resolve()
  const enqueue = (operation) => {
    const next = pending.catch(() => {}).then(operation)
    pending = next
    return next
  }
  return {
    async read() {
      try {
        return await transformSecret(await readFile(file, 'utf8'), true)
      } catch (error) {
        if (error.code === 'ENOENT') return ''
        throw error
      }
    },
    write(value) {
      return enqueue(async () => {
        const encrypted = await transformSecret(value)
        await mkdir(directory, { recursive: true })
        await writeFile(file + '.tmp', encrypted)
        await rename(file + '.tmp', file)
      })
    },
    remove() {
      return enqueue(async () => {
        try {
          await unlink(file)
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      })
    },
  }
}
