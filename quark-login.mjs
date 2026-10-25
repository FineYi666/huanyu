import { randomUUID } from 'node:crypto'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SUCCESS = 2000000

// Domain-scoped cookie jar. Its contents never leave the local service as JSON.
export class QuarkCookieJar {
  #values = new Map()
  absorb(response, origin) {
    const host = new URL(origin).hostname
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';')
      const equals = pair.indexOf('=')
      if (equals < 1) continue
      const name = pair.slice(0, equals).trim(),
        value = pair.slice(equals + 1).trim()
      if (!/^[\w-]+$/.test(name) || /[\r\n]/.test(value)) continue
      const domainAttribute = attributes.find((attribute) =>
        /^\s*domain=/i.test(attribute),
      )
      const domain = domainAttribute
        ? domainAttribute.split('=')[1].trim().replace(/^\./, '').toLowerCase()
        : host
      if (
        !(domain === 'quark.cn' || domain.endsWith('.quark.cn')) ||
        !(host === domain || host.endsWith('.' + domain))
      )
        continue
      const cookiePath =
        attributes
          .find((attribute) => /^\s*path=/i.test(attribute))
          ?.trim()
          .slice(5) || '/'
      const key = `${domain}|${cookiePath}|${name}`
      if (
        !value ||
        attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute))
      )
        this.#values.delete(key)
      else
        this.#values.set(key, {
          domain,
          path: cookiePath,
          name,
          value,
          hostOnly: !domainAttribute,
        })
    }
  }
  header(origin) {
    const url = new URL(origin)
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'quark.cn' || url.hostname.endsWith('.quark.cn'))
    )
      return ''
    return [...this.#values.values()]
      .filter(
        (cookie) =>
          (url.hostname === cookie.domain ||
            (!cookie.hostOnly && url.hostname.endsWith('.' + cookie.domain))) &&
          url.pathname.startsWith(cookie.path),
      )
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
  }
  clear() {
    this.#values.clear()
  }
}

export function createQuarkLogin({
  onConnected,
  fetcher = fetch,
  now = Date.now,
}) {
  const sessions = new Map()
  function cancel(id) {
    const session = sessions.get(id)
    if (session) {
      session.abort.abort()
      session.jar.clear()
      sessions.delete(id)
    }
  }
  function cancelAll() {
    for (const id of sessions.keys()) cancel(id)
  }
  async function request(session, input) {
    const url = new URL(input)
    if (
      url.protocol !== 'https:' ||
      !['uop.quark.cn', 'pan.quark.cn', 'drive-pc.quark.cn'].includes(
        url.hostname,
      )
    )
      throw new Error('不支持的夸克登录地址')
    let response
    try {
      response = await fetcher(url.href, {
        redirect: 'error',
        signal: AbortSignal.any([
          session.abort.signal,
          AbortSignal.timeout(12000),
        ]),
        headers: {
          'User-Agent': UA,
          Referer: 'https://pan.quark.cn/',
          Origin: 'https://pan.quark.cn',
          Cookie: session.jar.header(url.href),
        },
      })
    } catch {
      throw new Error('无法连接夸克登录服务，请检查网络后重新生成二维码')
    }
    session.jar.absorb(response, url.href)
    if (!response.ok) throw new Error('夸克登录服务暂时不可用，请稍后重试')
    try {
      return await response.json()
    } catch {
      throw new Error('夸克登录服务返回格式异常，请重新扫码')
    }
  }
  function casUrl(endpoint, token) {
    const url = new URL(`https://uop.quark.cn/cas/ajax/${endpoint}`)
    url.search = new URLSearchParams({
      client_id: '532',
      v: '1.2',
      request_id: randomUUID(),
      ...(token ? { token } : {}),
    })
    return url.href
  }
  async function complete(session, ticket) {
    const accountUrl = new URL('https://pan.quark.cn/account/info')
    accountUrl.search = new URLSearchParams({ st: ticket, lw: 'scan' })
    const account = await request(session, accountUrl.href)
    // The account endpoint uses success:true with code:"OK", unlike drive APIs' numeric zero.
    if (account.success !== true) {
      const code =
        (typeof account.code === 'string' &&
          /^[\w-]{1,60}$/.test(account.code)) ||
        typeof account.code === 'number'
          ? String(account.code)
          : 'UNKNOWN'
      throw new Error(
        `夸克登录未完成（状态 ${code}），请在夸克官方应用检查登录验证或重新扫码`,
      )
    }
    const driveUrl =
      'https://drive-pc.quark.cn/1/clouddrive/file/sort?pr=ucpro&fr=pc&pdir_fid=0&_page=1&_size=1'
    const drive = await request(session, driveUrl)
    if ((drive.code !== undefined && drive.code !== 0) || drive.status >= 400)
      throw new Error(
        `夸克：${String(drive.message || '账号无法访问网盘，请在官方应用检查账号状态').slice(0, 150)}`,
      )
    if (session.abort.signal.aborted || sessions.get(session.id) !== session)
      return { status: 'cancelled' }
    const cookie = session.jar.header(driveUrl)
    if (!cookie || !/(?:^|;\s*)(?:__pus|__puus|__kps)=/.test(cookie))
      throw new Error('夸克未返回有效登录凭据，请重新扫码')
    await onConnected(cookie)
    session.status = 'connected'
    session.token = ''
    session.jar.clear()
    return { status: 'connected' }
  }
  return {
    async start() {
      cancelAll()
      const session = {
        id: randomUUID(),
        jar: new QuarkCookieJar(),
        abort: new AbortController(),
        token: '',
        expiresAt: now() + 5 * 60000,
        status: 'waiting',
        pending: null,
        lastPoll: -Infinity,
      }
      const result = await request(session, casUrl('getTokenForQrcodeLogin'))
      if (result.status !== SUCCESS || !result.data?.members?.token)
        throw new Error('夸克二维码获取失败，请稍后重试')
      session.token = result.data.members.token
      sessions.set(session.id, session)
      const qrUrl = new URL('https://su.quark.cn/4_eMHBJ')
      qrUrl.search = new URLSearchParams({
        token: session.token,
        client_id: '532',
        ssb: 'weblogin',
        uc_param_str: '',
        uc_biz_str: 'S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0',
      })
      return {
        sessionId: session.id,
        qrUrl: qrUrl.href,
        expiresAt: session.expiresAt,
      }
    },
    async poll(id) {
      const session = sessions.get(id)
      if (!session) return { status: 'expired' }
      if (now() > session.expiresAt) {
        cancel(id)
        return { status: 'expired' }
      }
      if (session.status === 'connected') return { status: 'connected' }
      if (session.pending) return session.pending
      if (now() - session.lastPoll < 1800) return { status: 'waiting' }
      session.lastPoll = now()
      session.pending = (async () => {
        try {
          const result = await request(
            session,
            casUrl('getServiceTicketByQrcodeToken', session.token),
          )
          if (result.status === SUCCESS && result.data?.members?.service_ticket)
            return await complete(session, result.data.members.service_ticket)
          if (result.status === 50004001) return { status: 'waiting' }
          if ([50004002, 50004003, 50004004].includes(result.status)) {
            cancel(id)
            return { status: 'expired' }
          }
          throw new Error('夸克登录状态异常，请重新生成二维码后扫码')
        } catch (error) {
          cancel(id)
          throw error
        } finally {
          session.pending = null
        }
      })()
      return session.pending
    },
    cancel,
    cancelAll,
  }
}
