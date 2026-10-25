import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createPosterCache, posterKey } from '../poster-cache.mjs'
import { createSeasonalService, fetchSeasonal } from '../seasonal.mjs'
const bytes = Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0])
async function fixture(t) {const root=await mkdtemp(path.join(os.tmpdir(),'yingyu-posters-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
test('posters use bundled copies offline and preserve disk downloads across restarts',async t=>{
 const root=await fixture(t),data=path.join(root,'data'),url='https://lain.bgm.tv/pic/cover/l/test.jpg',key=posterKey(url)
 await mkdir(path.join(root,'dist','posters'),{recursive:true});await writeFile(path.join(root,'dist','posters',`${key}.img`),bytes)
 let calls=0;const fetcher=async()=>{calls++;throw new Error('offline')}
 const cache=await createPosterCache({root,data,fetcher});assert.equal(cache.localize(url),`/posters/${key}.img`);assert.deepEqual(await cache.read(key),bytes);assert.equal(calls,0)
 const remote='https://lain.bgm.tv/pic/cover/l/new.jpg';const online=await createPosterCache({root,data,fetcher:async()=>{calls++;return new Response(bytes,{headers:{'Content-Type':'image/jpeg'}})}})
 online.localize(remote);await Promise.all([online.read(posterKey(remote)),online.read(posterKey(remote))]);assert.equal(calls,1)
 const restarted=await createPosterCache({root,data,fetcher});assert.deepEqual(await restarted.read(posterKey(remote)),bytes);assert.equal(calls,1)
})
test('poster requests never fetch unregistered URLs, private hosts or redirected private hosts',async t=>{
 const root=await fixture(t);let calls=0
 const cache=await createPosterCache({root,data:path.join(root,'data'),fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}})
 assert.equal(cache.localize('http://127.0.0.1/private'),'http://127.0.0.1/private');await assert.rejects(cache.read('0'.repeat(32)));assert.equal(calls,0)
 const url='https://lain.bgm.tv/test.jpg';cache.localize(url);await assert.rejects(cache.read(posterKey(url)));assert.equal(calls,2);await assert.rejects(cache.read(posterKey(url)));assert.equal(calls,2)
})
test('seasonal refresh retries transient network failures without exposing raw fetch errors or discarding cached titles',async t=>{
 const root=await fixture(t),now=()=>new Date('2026-10-25T00:00:00Z');const data=path.join(root,'data');await mkdir(data)
 const cached={season:{id:'2026-Q4'},updatedAt:'2026-10-24T00:00:00Z',items:[{id:'seasonal-1',title:'缓存作品',airDate:'2026-10-01',score:8,votes:100}],slides:[]};await writeFile(path.join(root,'seasonal.json'),JSON.stringify(cached))
 let calls=0;const service=await createSeasonalService({root,data,now,fetcher:async()=>{calls++;throw new TypeError('fetch failed')}})
 const value=await service.update();assert.equal(calls,3);assert.equal(value.items[0].title,'缓存作品');assert.match(value.error,/暂时无法连接/);assert.doesNotMatch(value.error,/fetch failed/)
 let attempts=0;const refreshed=await fetchSeasonal({now:now(),fetcher:async()=>{if(++attempts===1)throw new Error('connection reset');return new Response(JSON.stringify({total:1,data:[{id:1,name_cn:'重试成功',platform:'TV',date:'2026-10-01',rating:{score:6,total:10}}]}))}});assert.equal(attempts,2);assert.equal(refreshed.items[0].title,'重试成功')
})
