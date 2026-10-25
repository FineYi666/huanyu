export const DEFAULT_SUBTITLE_STYLE = Object.freeze({ scale: 100, x: 50, y: 90 })
export function normalizeSubtitleStyle(input) {
  const value = input && typeof input === 'object' ? input : {}
  const number = (key, min, max) => typeof value[key] === 'number' && Number.isFinite(value[key]) ? Math.round(Math.min(max, Math.max(min, value[key]))) : DEFAULT_SUBTITLE_STYLE[key]
  return { scale: number('scale', 50, 200), x: number('x', 10, 90), y: number('y', 5, 95) }
}
export function positionSubtitleCue(cue, input, viewport = {width: 889, height: 500}) {
  const style = normalizeSubtitleStyle(input)
  if (!('line' in cue) || !('position' in cue)) return
  cue.snapToLines = false
  cue.position = style.x
  cue.positionAlign = 'center'
  cue.align = 'center'
  cue.size = Math.min(90, 2 * Math.min(style.x, 100 - style.x))
  const font=subtitleFontPixels(viewport.height,style.scale),width=viewport.width*cue.size/100
  const lines=String(cue.text || '').replace(/<[^>]*>/g,'').split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil(Array.from(line).reduce((sum,c)=>sum+(/[^\x00-\xff]/.test(c)?1:0.6),0)*font/Math.max(1,width))),0)
  const block=Math.min(85,lines*font*1.35/Math.max(1,viewport.height)*100)
  const anchor=style.y>=70?1:style.y<=30?0:0.5
  // Chromium does not consistently implement lineAlign on paused/fullscreen cues.
  // Position their top edge explicitly and keep multiline captions in the frame.
  cue.line=Math.max(2,Math.min(98-block,style.y-block*anchor))
  cue.lineAlign='start'
}
export function subtitleFontPixels(height, scale = 100) {
  return Math.round(Math.max(10, height * 0.045 * normalizeSubtitleStyle({scale}).scale / 100) * 10) / 10
}
