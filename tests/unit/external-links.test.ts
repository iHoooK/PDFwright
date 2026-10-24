import { describe, expect, it } from 'vitest'
import { DEVELOPER_LINKS, isAllowedExternalUrl, RELEASES_PAGE } from '@shared/external-links'

describe('isAllowedExternalUrl', () => {
  it('разрешает все ссылки раздела «О разработчике» и страницу релизов', () => {
    for (const link of DEVELOPER_LINKS) {
      expect(isAllowedExternalUrl(link.url), link.url).toBe(true)
    }
    expect(isAllowedExternalUrl(RELEASES_PAGE)).toBe(true)
  })

  it('отклоняет чужие хосты, http, логины и порты', () => {
    const rejected = [
      'https://evil.example.com/',
      'http://promptix.ru/',
      'https://user:pass@promptix.ru/',
      'https://promptix.ru:8443/',
      'https://promptix.ru.evil.com/',
      'javascript:alert(1)',
      'file:///C:/Windows/system32',
      'not a url',
      ''
    ]
    for (const url of rejected) {
      expect(isAllowedExternalUrl(url), url).toBe(false)
    }
  })
})
