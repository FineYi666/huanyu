export const SKIN_IDS = [
  'grove',
  'aurora',
  'ember',
  'lunar',
  'synth',
  'gilded',
  'glacier',
]
import { normalizeSubtitleStyle } from './subtitle-style.mjs'

// Older libraries get appearance defaults without changing media or playback preferences.
export function normalizeSettings(input = {}) {
  return {
    showSamples:
      typeof input.showSamples === 'boolean' ? input.showSamples : true,
    autoNext: typeof input.autoNext === 'boolean' ? input.autoNext : true,
    subtitlesEnabled: typeof input.subtitlesEnabled === 'boolean' ? input.subtitlesEnabled : true,
    subtitleStyle: normalizeSubtitleStyle(input.subtitleStyle),
    theme: input.theme === 'dark' ? 'dark' : 'light',
    skin: SKIN_IDS.includes(input.skin) ? input.skin : 'grove',
    glass: typeof input.glass === 'boolean' ? input.glass : true,
    ambientMotion: typeof input.ambientMotion === 'boolean' ? input.ambientMotion : true,
    deepseekAuto:
      typeof input.deepseekAuto === 'boolean' ? input.deepseekAuto : true,
    deepseekModel:
      typeof input.deepseekModel === 'string' &&
      /^[\w.:-]{1,100}$/.test(input.deepseekModel)
        ? input.deepseekModel
        : 'deepseek-flash',
    deepseekModels: Array.isArray(input.deepseekModels)
      ? input.deepseekModels
          .filter((id) => typeof id === 'string' && /^[\w.:-]{1,100}$/.test(id))
          .slice(0, 50)
      : [],
  }
}
