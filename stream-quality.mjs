export function qualityLabel(height, name = '') {
  if (name === 'original') return '原画 · 最高'
  if (name === '4k' || height >= 2160) return '4K · 超清'
  if (name === '2k' || height >= 1440) return '2K · 超清'
  if (name === 'super' || height >= 1080) return '超清 · 1080P'
  if (name === 'high' || height >= 720) return '高清 · 720P'
  if (name === 'normal' || name === 'low' || height > 0)
    return `标清${height ? ` · ${height}P` : ''}`
  return '原画 · 源清晰度'
}
export function rankLevels(levels) {
  return levels
    .map((level, index) => ({
      id: `hls:${index}`,
      height: level.height || 0,
      bitrate: level.bitrate || 0,
      label: qualityLabel(level.height),
    }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
}
