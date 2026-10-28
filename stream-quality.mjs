export function resolutionHeight(width = 0, height = 0) {
  // Widescreen films often crop the black bars (e.g. 1920×800 is a Full HD
  // release). Preserve the real dimensions while ranking its resolution tier.
  return Math.max(height, width >= 3840 ? 2160 : width >= 2560 ? 1440 : width >= 1920 ? 1080 : width >= 1280 ? 720 : 0)
}
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
      label: qualityLabel(resolutionHeight(level.width, level.height)),
    }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
}
