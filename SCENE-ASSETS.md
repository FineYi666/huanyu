# 幻屿场景皮肤素材

两张原创环境图均通过内置 image_gen 工具生成，用户参考图仅作为风格参考。动画由本地 CSS 实现，背景文件随安装包携带，无需联网。

- Synthwave 城市：`public/artwork/skins/synthwave-city.png`
- 雪山湖泊：`public/artwork/skins/winter-alpine.png`

## 最终生成提示词：Synthwave
Use case: stylized-concept. Create one original widescreen 16:9 cinematic environment illustration to use as a desktop media player's Synthwave skin background. Scene: 1980s retrofuturist coastal neon city at midnight, huge striped magenta sunset disk on the horizon, purple mountains, palms at the outer edges, turquoise and pink skyscraper window lights, a rain-slick highway receding into the city with vivid pink reflections, one small unbranded angular retro sports car lower left. Refined atmospheric perspective, rich midnight indigo shadows, neon hot pink with cyan highlights, subtle film grain. Keep the middle-left sky and distant road readable under translucent interface panels, with most interesting skyline silhouette across the upper right and horizon. Full-bleed landscape artwork only: NO text, no UI, no buttons, no borders, no watermark. The attached user image is style inspiration, not an edit target. Generate a new standalone landscape background.

## 最终生成提示词：雪景
Use case: photorealistic-natural. Create one original widescreen 16:9 cinematic landscape photograph for an immersive winter desktop media player skin. Sweeping alpine panorama at blue hour with majestic jagged snow-covered mountains, an icy lake curving through a misty valley, dense snow-laden pine forests in foreground, a small remote wooden cabin glowing warm amber near lower right. Frost-covered pines frame the far left edge. Pale blue luminous sky with soft clouds and a touch of sunrise light near the horizon on right, fine natural snow textures, beautiful realistic atmospheric depth, restrained icy blue and silver palette, serene and premium. Clear detailed environment, no motion blur, do not paint large foreground snowflakes: those will be animated separately in code. Keep middle sky and lake relatively calm so translucent interface overlays remain legible. Full-bleed landscape artwork only, no text, no interface, no buttons, no watermark. User supplied second image is style inspiration only, not an edit target. Generate a fresh standalone landscape.

## 动态实现
低频装饰氛围，使用 CSS transform / opacity 的线性运动与现有 --ease-in-out。飘雪 18–33 秒、网格 12 秒、薄雾 28 秒。背景开关关闭、页面隐藏、播放器打开时暂停；系统减少动态效果时关闭场景运动，保留静态环境图。实际视频画面没有天气覆盖层。
