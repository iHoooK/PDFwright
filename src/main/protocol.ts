import { net, protocol } from 'electron'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveWithinDir } from './services/fs-utils'

export const APP_SCHEME = 'app'
export const RENDERER_HOST = 'renderer'
export const RENDERER_ORIGIN = `${APP_SCHEME}://${RENDERER_HOST}`

/**
 * Собранный renderer отдаётся по схеме app://renderer/ вместо file://:
 * так работают fetch и Worker (pdf.js загружает CMaps, шрифты и WASM через
 * fetch), а Content-Security-Policy с 'self' означает только наши файлы.
 * Регистрировать схему нужно до app.whenReady().
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true
      }
    }
  ])
}

export function installAppProtocol(rendererDir: string, csp: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== RENDERER_HOST) return new Response('Not found', { status: 404 })
    const pathname = decodeURIComponent(url.pathname)
    const file = resolveWithinDir(rendererDir, pathname === '/' ? 'index.html' : pathname)
    if (file === null) return new Response('Forbidden', { status: 403 })
    const response = await net.fetch(pathToFileURL(file).href)
    if (extname(file) !== '.html') return response
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
    return new Response(response.body, { status: response.status, headers })
  })
}

export function rendererIndexUrl(): string {
  return `${RENDERER_ORIGIN}/index.html`
}

export function rendererDirFromMain(mainDir: string): string {
  return join(mainDir, '..', 'renderer')
}
