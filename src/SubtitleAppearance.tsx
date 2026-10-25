import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from '../subtitle-style.mjs'
export default function SubtitleAppearance({value,onChange}:{value:SubtitleStyle;onChange:(value:SubtitleStyle)=>void}) {
  return <details className="subtitle-appearance" open>
    <summary><SlidersHorizontal size={15}/>字幕大小与位置<span>自动记住 · 全屏生效</span></summary>
    <div className="subtitle-style-sliders">
      <label><span>字幕大小 <output>{value.scale}%</output></span><input aria-label="字幕大小" type="range" min="50" max="200" step="5" value={value.scale} onChange={e=>onChange({...value,scale:Number(e.target.value)})}/><small>小<span>大</span></small></label>
      <label><span>上下位置 <output>{value.y}%</output></span><input aria-label="字幕上下位置" type="range" min="5" max="95" value={value.y} onChange={e=>onChange({...value,y:Number(e.target.value)})}/><small>顶部<span>底部</span></small></label>
      <label><span>左右位置 <output>{value.x}%</output></span><input aria-label="字幕左右位置" type="range" min="10" max="90" value={value.x} onChange={e=>onChange({...value,x:Number(e.target.value)})}/><small>左侧<span>右侧</span></small></label>
    </div>
    <div className="subtitle-style-presets"><div>{[['顶部',10],['居中',50],['底部',90]].map(([label,y])=><button type="button" key={label} className="button subtle" onClick={()=>onChange({...value,x:50,y:Number(y)})}>{label}</button>)}</div><button type="button" className="text-button" onClick={()=>onChange({...DEFAULT_SUBTITLE_STYLE})}><RotateCcw size={12}/>恢复默认</button></div>
    <p>适用于可选字幕和外挂字幕；已烧录在视频画面里的文字无法调整。</p>
  </details>
}
