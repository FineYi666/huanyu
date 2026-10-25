import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuarkLogin, QuarkCookieJar } from '../quark-login.mjs'

const response = (data, cookies = []) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify(data), { headers })
}

test('cookie jar respects official domains, host-only cookies and empty deletion values', () => {
  const jar = new QuarkCookieJar()
  jar.absorb(
    response({}, [
      '__pus=private; Domain=.quark.cn; Path=/; HttpOnly',
      'uop_only=local; Path=/',
      'bad=blocked; Domain=evil.invalid; Path=/',
    ]),
    'https://uop.quark.cn/cas/ajax/login',
  )
  assert.equal(
    jar.header('https://drive-pc.quark.cn/1/clouddrive/file/sort'),
    '__pus=private',
  )
  assert.ok(jar.header('https://uop.quark.cn/').includes('uop_only=local'))
  assert.equal(jar.header('https://evil.invalid/'), '')
  jar.absorb(
    response({}, ['__pus=; Domain=.quark.cn; Path=/; Max-Age=0']),
    'https://pan.quark.cn/account/info',
  )
  assert.equal(jar.header('https://drive-pc.quark.cn/'), '')
  jar.clear()
  assert.equal(jar.header('https://uop.quark.cn/'), '')
})

test('QR login exchanges the official ticket once and keeps all credentials out of public results', async () => {
  let connected = '',
    time = 1000,
    polls = 0,
    exchanges = 0
  const login = createQuarkLogin({
    now: () => time,
    onConnected: (cookie) => {
      connected = cookie
    },
    fetcher: async (url, options) => {
      assert.equal(options.redirect, 'error')
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('getTokenForQrcodeLogin'))
        return response({
          status: 2000000,
          data: { members: { token: 'qr-private-token' } },
        })
      if (parsed.pathname.endsWith('getServiceTicketByQrcodeToken')) {
        polls++
        return response(
          polls === 1
            ? { status: 50004001 }
            : {
                status: 2000000,
                data: { members: { service_ticket: 'private-ticket' } },
              },
        )
      }
      if (parsed.pathname === '/account/info') {
        exchanges++
        assert.equal(parsed.searchParams.get('st'), 'private-ticket')
        return response({ success: true, code: 'OK' }, [
          '__pus=private-session; Domain=.quark.cn; Path=/; HttpOnly',
        ])
      }
      assert.equal(parsed.hostname, 'drive-pc.quark.cn')
      assert.equal(options.headers.Cookie, '__pus=private-session')
      return response({ code: 0, status: 200, data: { list: [] } }, [
        '__puus=drive-session; Domain=.quark.cn; Path=/; HttpOnly',
      ])
    },
  })
  const start = await login.start()
  assert.equal(new URL(start.qrUrl).hostname, 'su.quark.cn')
  assert.deepEqual(await login.poll(start.sessionId), { status: 'waiting' })
  time += 2300
  const result = await Promise.all([
    login.poll(start.sessionId),
    login.poll(start.sessionId),
  ])
  assert.ok(result.every((value) => value.status === 'connected'))
  assert.equal(exchanges, 1)
  assert.equal(connected, '__pus=private-session; __puus=drive-session')
  assert.ok(!JSON.stringify(result).includes('private'))
  assert.deepEqual(await login.poll(start.sessionId), { status: 'connected' })
})

test('cancelled or expired QR sessions cannot bind and account restrictions are reported', async () => {
  let time = 0,
    connected = false
  const fetcher = async (url) =>
    url.includes('getToken')
      ? response({ status: 2000000, data: { members: { token: 'token' } } })
      : url.includes('getServiceTicket')
        ? response({
            status: 2000000,
            data: { members: { service_ticket: 'ticket' } },
          })
        : url.includes('/account/info')
          ? response({ success: true }, [
              '__pus=session; Domain=.quark.cn; Path=/',
            ])
          : response({
              code: 403,
              status: 403,
              message: '账号限制，请在官方页面处理',
            })
  const login = createQuarkLogin({
    now: () => time,
    fetcher,
    onConnected: () => {
      connected = true
    },
  })
  const first = await login.start()
  login.cancel(first.sessionId)
  assert.deepEqual(await login.poll(first.sessionId), { status: 'expired' })
  const second = await login.start()
  time += 6 * 60000
  assert.deepEqual(await login.poll(second.sessionId), { status: 'expired' })
  const third = await login.start()
  await assert.rejects(login.poll(third.sessionId), /账号限制/)
  assert.equal(connected, false)
  assert.deepEqual(await login.poll(third.sessionId), { status: 'expired' })
})
