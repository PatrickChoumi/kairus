import { describe, expect, it } from 'vitest'
import { pieces, shorten } from './links'

/*
 * Turning text into links is where a messenger grows its first injection bug.
 * The rule enforced here is that nothing ever becomes markup: this cuts a
 * string into pieces and labels them, and React escapes the rest. So the cases
 * worth pinning are about *what counts as a link* — a scheme nobody should
 * follow, a closing parenthesis that belongs to the sentence and not the URL.
 */

const links = (body: string) => pieces(body).filter((p) => p.href)
const text = (body: string) =>
  pieces(body)
    .map((p) => p.text)
    .join('')

describe('finding links', () => {
  it('leaves a message with no link in one piece', () => {
    expect(pieces('rien à voir ici')).toEqual([{ text: 'rien à voir ici' }])
  })

  it('never loses a character, whatever it cuts', () => {
    for (const body of [
      'voir https://exemple.fr/a et https://exemple.fr/b',
      'www.exemple.fr, puis autre chose',
      'https://exemple.fr',
      'pas de lien du tout',
      '(https://exemple.fr/a)',
    ]) {
      expect(text(body)).toBe(body)
    }
  })

  it('finds several links in one message, in order', () => {
    const found = links('d’abord https://un.exemple.fr puis https://deux.exemple.fr')
    expect(found.map((p) => p.text)).toEqual(['https://un.exemple.fr', 'https://deux.exemple.fr'])
  })

  it('puts https in front of a bare www., and shows what was written', () => {
    const [link] = links('va sur www.exemple.fr')
    expect(link?.text).toBe('www.exemple.fr')
    expect(link?.href).toBe('https://www.exemple.fr/')
  })
})

describe('what must not become a link', () => {
  it('refuses a scheme a reader cannot reason about', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox',
      'file:///etc/passwd',
    ]) {
      expect(links(`regarde ${hostile}`)).toEqual([])
    }
  })

  it('refuses something that only looks like a host', () => {
    expect(links('http://localhost')).toEqual([])
    expect(links('https://')).toEqual([])
  })

  it('keeps the hostile text visible rather than swallowing it', () => {
    // Left as text it is inert, and the reader sees what was actually sent.
    expect(text('javascript:alert(1)')).toBe('javascript:alert(1)')
  })
})

describe('where a link ends', () => {
  it('does not eat the punctuation that ends the sentence', () => {
    expect(links('voir https://exemple.fr/page.')[0]?.text).toBe('https://exemple.fr/page')
    expect(links('vraiment https://exemple.fr/a !')[0]?.text).toBe('https://exemple.fr/a')
    expect(links('« https://exemple.fr/a »')[0]?.text).toBe('https://exemple.fr/a')
  })

  it('gives back a closing bracket that belongs to the sentence', () => {
    expect(links('(voir https://exemple.fr/a)')[0]?.text).toBe('https://exemple.fr/a')
  })

  it('keeps a closing bracket that belongs to the address', () => {
    const [link] = links('https://fr.wikipedia.org/wiki/Machine_de_Turing_(automate)')
    expect(link?.text).toBe('https://fr.wikipedia.org/wiki/Machine_de_Turing_(automate)')
  })

  it('stops at whitespace, never running into the next word', () => {
    const [link] = links('https://exemple.fr/a puis du texte')
    expect(link?.text).toBe('https://exemple.fr/a')
  })

  it('keeps a query string and a fragment intact', () => {
    const [link] = links('https://exemple.fr/chercher?q=turing&n=2#resultats')
    expect(link?.text).toBe('https://exemple.fr/chercher?q=turing&n=2#resultats')
  })
})

describe('showing a long link', () => {
  it('drops the scheme, which nobody reads', () => {
    expect(shorten('https://exemple.fr/page')).toBe('exemple.fr/page')
  })

  it('cuts what would break the bubble', () => {
    const long = `https://exemple.fr/${'a'.repeat(120)}`
    expect(shorten(long).length).toBeLessThanOrEqual(48)
    expect(shorten(long).endsWith('…')).toBe(true)
  })
})
