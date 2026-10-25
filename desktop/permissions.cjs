function allowFullscreen(permission, requestingUrl, appOrigin) {
  if (permission !== 'fullscreen') return false
  try { return new URL(requestingUrl).origin === appOrigin } catch { return false }
}
module.exports = { allowFullscreen }
