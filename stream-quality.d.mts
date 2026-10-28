export type QualityOption = {
  id: string
  label: string
  height?: number
  bitrate?: number
}
export function qualityLabel(height?: number, name?: string): string
export function resolutionHeight(width?: number, height?: number): number
export function rankLevels(
  levels: { width?: number; height?: number; bitrate?: number }[],
): QualityOption[]
