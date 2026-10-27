export type QualityOption = {
  id: string
  label: string
  height?: number
  bitrate?: number
}
export function qualityLabel(height?: number, name?: string): string
export function rankLevels(
  levels: { height?: number; bitrate?: number }[],
): QualityOption[]
