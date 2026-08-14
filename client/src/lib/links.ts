/*
 * Finding the links in what someone wrote.
 *
 * Message bodies are plain text and stay plain text: React escapes them, and
 * nothing here ever produces markup from a string. This only cuts the text
 * into pieces and says which pieces are links — the rendering side decides
 * what to do with that, so there is no path from a message to `innerHTML`.
 *
 * The grammar is deliberately narrow. Only `https:` and `http:` become links,
 * because those are the two schemes a reader can reason about; `javascript:`,
 * `data:` and the rest are left as text, where they are inert. A bare `www.`
 * is recognised because people write it that way, and gets `https://` put in
 * front of it.
 */

export type Piece = {
  /** What is shown. For a bare `www.` link this differs from the href. */
  text: string
  /** Where it goes, when this piece is a link. */
  href?: string
}

/*
 * Deliberately not one of the clever URL regexes: those chase the RFC and end
 * up matching things nobody meant. This takes a scheme or a `www.`, runs to
 * the first whitespace, and leaves the trailing punctuation to `trimTail` —
 * which is where the real difficulty is anyway.
 */
const CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>]+/gi

/** Closing punctuation that ends a sentence rather than belonging to a URL. */
const TRAILING = /[.,;:!?…»"')\]}]+$/

/**
 * Trims what the sentence put there rather than the author.
 *
 * `(voir https://exemple.fr/a)` must not swallow the closing parenthesis, but
 * `https://fr.wikipedia.org/wiki/Turing_(machine)` must keep it. So a closing
 * bracket is given back only when the URL does not already carry its opening
 * partner.
 */
function trimTail(raw: string): string {
  const cut = raw.replace(TRAILING, '')
  if (cut === raw) return raw

  let kept = ''
  for (const character of raw.slice(cut.length)) {
    const opener = character === ')' ? '(' : character === ']' ? '[' : character === '}' ? '{' : ''
    if (!opener) break
    const opens = cut.split(opener).length - 1
    const closes = cut.split(character).length - 1
    // Unbalanced inside the URL: this bracket closes the address, not the phrase.
    if (opens <= closes) break
    kept += character
  }
  return cut + kept
}

/**
 * Whether this is somewhere a browser should be sent. Parsing is the test:
 * what `URL` refuses is not a link, and what does not speak http or https
 * stays text.
 */
function safeHref(candidate: string): string | null {
  const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  // A dot in the host is what makes it somewhere rather than something.
  if (!parsed.hostname.includes('.')) return null
  return parsed.href
}

/**
 * Cuts a message into plain pieces and link pieces, in order. A body with no
 * link comes back as a single piece, which is the common case and costs one
 * allocation.
 */
export function pieces(body: string): Piece[] {
  if (!body || !/(https?:\/\/|www\.)/i.test(body)) return [{ text: body }]

  const out: Piece[] = []
  let at = 0

  for (const match of body.matchAll(CANDIDATE)) {
    const start = match.index ?? 0
    const url = trimTail(match[0])
    const href = safeHref(url)

    if (start > at) out.push({ text: body.slice(at, start) })
    // A refused candidate stays visible as text: inert, and the reader sees
    // exactly what was sent rather than a silently swallowed string.
    out.push(href ? { text: url, href } : { text: url })
    at = start + url.length
  }

  if (at < body.length) out.push({ text: body.slice(at) })
  return out
}

/** What a link reads as when it is long enough to break the bubble. */
export function shorten(href: string, max = 48): string {
  const bare = href.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return bare.length <= max ? bare : `${bare.slice(0, max - 1)}…`
}
