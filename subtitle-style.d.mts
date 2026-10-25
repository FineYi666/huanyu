export type SubtitleStyle = { scale: number; x: number; y: number }
export const DEFAULT_SUBTITLE_STYLE: Readonly<SubtitleStyle>
export function normalizeSubtitleStyle(input?: unknown): SubtitleStyle
export function positionSubtitleCue(cue: TextTrackCue, input: SubtitleStyle, viewport?: {width:number;height:number}): void
export function subtitleFontPixels(height: number, scale?: number): number
