import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSubtitleStyle,positionSubtitleCue,subtitleFontPixels} from '../subtitle-style.mjs'
import {normalizeSettings} from '../appearance.mjs'
test('subtitle layout defaults, bounds and preference normalization survive older libraries',()=>{
 assert.deepEqual(normalizeSettings({}).subtitleStyle,{scale:100,x:50,y:90})
 assert.deepEqual(normalizeSubtitleStyle({scale:999,x:-20,y:999}),{scale:200,x:10,y:95})
 assert.deepEqual(normalizeSubtitleStyle({scale:'120',x:NaN,y:Infinity}),{scale:100,x:50,y:90})
 assert.deepEqual(normalizeSettings({subtitleStyle:{scale:145,x:60,y:20}}).subtitleStyle,{scale:145,x:60,y:20})
})
test('cue repositioning never changes subtitle timing, and font size scales with fullscreen viewport',()=>{
 const cue={startTime:10,endTime:15,line:'auto',position:'auto',snapToLines:true}
 positionSubtitleCue(cue,{scale:150,x:50,y:10})
 assert.equal(cue.line,10);assert.equal(cue.snapToLines,false);assert.equal(cue.lineAlign,'start')
 positionSubtitleCue(cue,{scale:150,x:70,y:90})
 assert.equal(cue.position,70);assert.equal(cue.lineAlign,'start');assert.equal(cue.size,60);assert.ok(cue.line<90)
 assert.equal(cue.startTime,10);assert.equal(cue.endTime,15)
 assert.ok(Math.abs(subtitleFontPixels(500,150)-subtitleFontPixels(500,100)*1.5)<0.1)
 assert.ok(subtitleFontPixels(1000,150)>subtitleFontPixels(500,150))
})
