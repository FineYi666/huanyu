const SOURCE_FIELDS = ['shareUrl','shareId','passcode','stoken','subtitleFiles','webSources','online']
export function replaceMediaSource(current, incoming) {
  if (!['local','quark'].includes(incoming.source) || !Array.isArray(incoming.episodes) || !incoming.episodes.length) throw new Error('新资源中没有可用视频，原资源已保留')
  const result={...current,source:incoming.source,sourceRevision:(current.sourceRevision || 0)+1,resourceChangedAt:Date.now()}
  for (const field of SOURCE_FIELDS) {
    delete result[field]
    if(incoming[field]!==undefined)result[field]=incoming[field]
  }
  const old=new Map(current.source===incoming.source ? current.episodes.map(episode=>[episode.id,episode]):[])
  result.episodes=incoming.episodes.map(episode=>{
    const previous=old.get(episode.id)
    return previous && (previous.fid || previous.path)===(episode.fid || episode.path) ? {...previous,...episode} : {...episode}
  })
  result.progress=Object.fromEntries(result.episodes.filter(episode=>old.has(episode.id) && (old.get(episode.id).fid || old.get(episode.id).path)===(episode.fid || episode.path) && current.progress?.[episode.id]).map(episode=>[episode.id,current.progress[episode.id]]))
  return result
}
