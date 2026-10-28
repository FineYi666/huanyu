import type { SkinId } from './skins'
import type { SubtitleStyle } from '../subtitle-style.mjs'
import type { MediaCategory } from '../media-category.mjs'

declare global {
  interface Window {
    yingyuDesktop?: {
      minimize: () => Promise<void>
      toggleMaximize: () => Promise<boolean>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (callback: (value: boolean) => void) => void
      openWeb: (url: string) => Promise<boolean>
      hide: () => Promise<void>
      quit: () => Promise<void>
      setCloseBehavior: (prefs: { ask: boolean; action: 'tray' | 'exit' }) => void
      onCloseAsk: (callback: () => void) => () => void
    }
  }
}

export type Source = 'local' | 'quark' | 'url' | 'sample'
export interface Episode {
  id: string
  name: string
  season?: number | null
  seasonGroup?: string
  episodeNumber?: number
  size?: number
  fid?: string
  shareToken?: string
  parentFid?: string
  savedFid?: string
}
export interface Media {
  subjectId?: string
  category?: MediaCategory
  id: string
  title: string
  subtitle?: string
  description?: string
  cover?: string
  year?: string
  genre?: string
  rating?: string
  total?: number
  source: Source
  episodes: Episode[]
  favorite?: boolean
  online?: { preferredId: string; sourceName: string; road: string; quality?: string }
  addedAt: number
  shareUrl?: string
  shareId?: string
  stoken?: string
  manual?: Partial<
    Record<'title' | 'description' | 'genre' | 'cover' | 'category', boolean>
  >
  metadataStatus?: 'idle' | 'queued' | 'loading' | 'ready' | 'partial' | 'error'
  metadataError?: string
  metadataProvider?: string
  posterProvider?: string
  posterSourceUrl?: string
  identifiedTitle?: string
  progress?: Record<string, { time: number; duration: number; at: number }>
}
export interface Game {
  id: string
  title: string
  description?: string
  cover?: string
  genre?: string
  exePath: string
  workDir?: string
  launchArgs?: string
  source: 'exe' | 'lnk'
  favorite?: boolean
  addedAt: number
  lastPlayedAt?: number
  playCount?: number
  manual?: Partial<
    Record<'title' | 'description' | 'genre' | 'cover', boolean>
  >
  metadataStatus?: 'idle' | 'loading' | 'ready' | 'partial' | 'error'
  metadataError?: string
}
export interface AppSettings {
  showSamples: boolean
  autoNext: boolean
  subtitlesEnabled: boolean
  subtitleStyle: SubtitleStyle
  theme: 'light' | 'dark'
  skin: SkinId
  glass: boolean
  ambientMotion: boolean
  quarkConnected: boolean
  quarkStorageError?: string
  deepseekAuto: boolean
  deepseekModel: string
  deepseekModels: string[]
  deepseekConnected: boolean
  deepseekStorageError: string
  closeAsk: boolean
  closeAction: 'tray' | 'exit'
  customAccent: string
  customBase: string
  customDark: boolean
  customBackgroundVersion: string
}
export interface AppState {
  media: Media[]
  games: Game[]
  settings: AppSettings
}
