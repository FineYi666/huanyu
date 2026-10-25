export const skins = [
  {
    id: 'grove',
    defaultTheme: 'light',
    name: '晨雾青屿',
    english: 'MORNING GROVE',
    description: '珍珠流光 · 柔和日光 · 液态沙丘',
    detail: '给日常放映，一点轻盈的绿意。',
    colors: ['#729b60', '#d8e9ca', '#f4f7f0'],
  },
  {
    id: 'aurora',
    defaultTheme: 'dark',
    name: '蓝金流光',
    english: 'BLUEGOLD FLOW',
    description: '蓝金流光 · 星云画卷 · 深海极光',
    detail: '把屏幕变成一扇通往深空的舷窗。',
    colors: ['#52b5ff', '#d9b45c', '#0a1428'],
  },
  {
    id: 'ember',
    defaultTheme: 'dark',
    name: '赤焰终端',
    english: 'EMBER TERMINAL',
    description: '猩红都市 · 赤焰霓虹 · 机械网格',
    detail: '启动你的专属放映引擎。',
    colors: ['#fa9452', '#a45b3c', '#202323'],
  },
  {
    id: 'lunar',
    defaultTheme: 'dark',
    name: '翡翠幻墨',
    english: 'JADE INK',
    description: '翡翠流墨 · 鎏金脉络 · 深潭幻境',
    detail: '让私人放映室，沉入一汪翡翠深渊。',
    colors: ['#4dd88a', '#d9b45c', '#0b1a10'],
  },
  {
    id: 'synth',
    defaultTheme: 'dark',
    name: '霓虹夜城',
    english: 'NEON CITY',
    description: '霓虹城市 · 条纹落日 · 80s 公路',
    detail: '在合成器的余晖里，驶向午夜放映。',
    colors: ['#ff5fb8', '#8a5cf6', '#120821'],
  },
  {
    id: 'gilded',
    defaultTheme: 'dark',
    name: '鎏金影厅',
    english: 'GILDED CINEMA',
    description: '黑金奢华 · 鎏金波浪 · 衬线光影',
    detail: '为经典大作，点亮一堂镀金的聚光灯。',
    colors: ['#d9b45c', '#8a6d34', '#0c0a07'],
  },
  {
    id: 'glacier',
    defaultTheme: 'light',
    name: '冰雪之境',
    english: 'GLACIER LIGHT',
    description: '雪山湖泊 · 冰蓝玻璃 · 动态飘雪',
    detail: '把放映室搬到雪山之巅的清晨。',
    colors: ['#3f87b8', '#a8d8f0', '#eef7fd'],
  },
] as const

export type SkinId = (typeof skins)[number]['id']
export const getSkin = (id?: string) =>
  skins.find((skin) => skin.id === id) || skins[0]
