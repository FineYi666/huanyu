import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packaged = fileURLToPath(new URL('./runtime/ffprobe.exe', import.meta.url))
let executable
let active = 0
const queue = []

// Inspect bounded bytes already fetched by the validated HTTP client. FFprobe
// receives stdin only and cannot open a remote URL or an embedded external file.
export async function inspectVideoSample(buffer) {
  if (!buffer?.length) return null
  if (active >= 3) await new Promise(resolve => queue.push(resolve))
  else active++
  try {
    executable ||= existsSync(packaged) ? packaged : require('ffprobe-static').path
    return await new Promise(resolve => {
      const child = spawn(executable, ['-v', 'error', '-protocol_whitelist', 'pipe', '-probesize', '262144', '-analyzeduration', '1000000', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', '-i', 'pipe:0'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
      let output = '', done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        try {
          const { width, height } = JSON.parse(output).streams?.[0] || {}
          resolve(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 16384 && height <= 16384 ? { width, height, resolutionSource: 'sample' } : null)
        } catch { resolve(null) }
      }
      const timer = setTimeout(() => { child.kill(); finish() }, 2500)
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 16384) { child.kill(); finish() } })
      child.stdin.on('error', () => {})
      child.on('error', finish)
      child.on('close', finish)
      child.stdin.end(buffer.subarray(0, 2 * 1024 * 1024))
    })
  } catch { return null }
  finally { const next = queue.shift(); if (next) next(); else active-- }
}
