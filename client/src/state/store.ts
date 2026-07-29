import { create } from 'zustand'
import { api, ApiError, getToken, setToken } from '../net/api'
import { connection, type Link } from '../net/socket'
import type { Conversation, Message, User } from '../net/types'

export type Theme = 'dark' | 'light'

type State = {
  status: 'booting' | 'out' | 'in'
  me: User | null
  link: Link

  conversations: Conversation[]
  messages: Record<string, Message[]>
  hydrated: Record<string, boolean>
  exhausted: Record<string, boolean>

  open: string | null
  replyTo: Message | null
  /** The message being rewritten, if any. Never set at the same time as replyTo. */
  editing: Message | null
  typing: Record<string, number>
  online: Record<string, boolean>

  blocked: User[]

  theme: Theme
  reading: boolean
  cursor: boolean
  notice: string | null
  /** Shown once, right after it is minted, and never recoverable afterwards. */
  keepsake: string | null
}

type Actions = {
  boot: () => Promise<void>
  signIn: (handle: string, password: string) => Promise<void>
  signUp: (handle: string, name: string, password: string) => Promise<void>
  signOut: () => void

  enter: (conversationId: string) => void
  leave: () => void
  startWith: (handle: string) => Promise<string | null>

  say: (body: string) => void
  reply: (message: Message | null) => void
  edit: (message: Message | null) => void
  revise: (body: string) => void
  retract: (message: Message) => void
  breathe: () => void
  older: () => Promise<void>

  block: (handle: string) => Promise<void>
  unblock: (handle: string) => Promise<void>
  loadBlocked: () => Promise<void>

  recover: (handle: string, phrase: string, password: string) => Promise<void>
  changePassphrase: (current: string, next: string) => Promise<void>
  mintRecoveryPhrase: () => Promise<void>
  revokeEverywhere: () => Promise<void>
  keep: () => void

  setTheme: (theme: Theme) => void
  toggleReading: () => void
  setCursor: (open: boolean) => void
  notify: (text: string | null) => void
}

const TYPING_LIFETIME = 4000
/** Mirrors the pre-paint script in index.html, so the two never disagree. */
const storedTheme = (): Theme => {
  const stored = localStorage.getItem('kairus.theme')
  if (stored === 'light' || stored === 'dark') return stored
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

let typingSentAt = 0
const typingTimers = new Map<string, number>()

export const useStore = create<State & Actions>((set, get) => {
  /** Newest conversation first, which is the only order that makes sense here. */
  const reorder = (list: Conversation[]) =>
    [...list].sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))

  const absorb = (message: Message, nonce?: string) => {
    const state = get()
    const list = state.messages[message.conversationId] ?? []

    // Replace the optimistic copy if this is our own echo.
    const withoutPending = nonce ? list.filter((m) => m.id !== nonce) : list
    const already = withoutPending.some((m) => m.id === message.id)
    const next = already
      ? withoutPending.map((m) => (m.id === message.id ? message : m))
      : [...withoutPending, message].sort((a, b) => a.createdAt - b.createdAt)

    const mine = message.senderId === state.me?.id
    const looking = state.open === message.conversationId && document.visibilityState === 'visible'

    set({
      messages: { ...state.messages, [message.conversationId]: next },
      conversations: reorder(
        state.conversations.map((c) =>
          c.id === message.conversationId
            ? {
                ...c,
                lastMessage: message,
                unread: mine || looking ? 0 : c.unread + 1,
              }
            : c,
        ),
      ),
    })

    if (looking && !mine) markRead(message.conversationId)
  }

  /**
   * An edit or a retraction. It replaces the message where it stands: it must
   * not re-sort the rail, and it must not mark anything unread — nothing new
   * was said.
   */
  const absorbRevision = (message: Message) => {
    const state = get()
    const list = state.messages[message.conversationId]
    if (list) {
      set({
        messages: {
          ...state.messages,
          [message.conversationId]: list.map((m) => (m.id === message.id ? message : m)),
        },
      })
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === message.conversationId && c.lastMessage?.id === message.id
          ? { ...c, lastMessage: message }
          : c,
      ),
      // Rewriting the message you were about to answer would answer the old one.
      replyTo: s.replyTo?.id === message.id ? message : s.replyTo,
      editing: s.editing?.id === message.id && message.deletedAt ? null : s.editing,
    }))
  }

  const markRead = (conversationId: string) => {
    connection.send({ t: 'read', conversation: conversationId })
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unread: 0 } : c,
      ),
    }))
  }

  const listen = () => {
    connection.onLink((link) => set({ link }))
    connection.on((event) => {
      switch (event.t) {
        case 'ready':
          // The server swaps an ageing token here; keeping the old one would
          // mean signing in again the moment it expires.
          if (event.token) setToken(event.token)
          set({
            me: event.user,
            status: 'in',
            conversations: reorder(event.conversations),
          })
          break

        case 'message':
          absorb(event.message, event.nonce)
          break

        case 'revised':
          absorbRevision(event.message)
          break

        case 'conversation':
          set((s) =>
            s.conversations.some((c) => c.id === event.conversation.id)
              ? {
                  conversations: reorder(
                    s.conversations.map((c) =>
                      c.id === event.conversation.id ? event.conversation : c,
                    ),
                  ),
                }
              : { conversations: reorder([event.conversation, ...s.conversations]) },
          )
          break

        case 'typing': {
          const id = event.conversation
          set((s) => ({ typing: { ...s.typing, [id]: Date.now() } }))
          window.clearTimeout(typingTimers.get(id))
          typingTimers.set(
            id,
            window.setTimeout(() => {
              typingTimers.delete(id)
              set((s) => {
                const { [id]: _gone, ...rest } = s.typing
                return { typing: rest }
              })
            }, TYPING_LIFETIME),
          )
          break
        }

        case 'read':
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === event.conversation && event.userId !== s.me?.id
                ? { ...c, peerReadAt: Math.max(c.peerReadAt, event.at) }
                : c,
            ),
          }))
          break

        case 'presence':
          set((s) => ({ online: { ...s.online, [event.userId]: event.online } }))
          break

        case 'error':
          set({ notice: event.message })
          // A revoked or expired token: there is nothing to reconnect with.
          if (event.code === 'expired') get().signOut()
          break
      }
    })
  }

  listen()

  const hydrate = async (conversationId: string) => {
    if (get().hydrated[conversationId]) return
    try {
      const { messages } = await api.messages(conversationId)
      set((s) => ({
        messages: { ...s.messages, [conversationId]: messages },
        hydrated: { ...s.hydrated, [conversationId]: true },
        exhausted: { ...s.exhausted, [conversationId]: messages.length < 60 },
      }))
    } catch (error) {
      set({ notice: error instanceof ApiError ? error.message : 'impossible de charger ce fil' })
    }
  }

  const land = (token: string, user: User) => {
    setToken(token)
    set({ me: user, status: 'in' })
    connection.open(token)
  }

  return {
    status: 'booting',
    me: null,
    link: 'offline',
    conversations: [],
    messages: {},
    hydrated: {},
    exhausted: {},
    open: null,
    replyTo: null,
    editing: null,
    typing: {},
    online: {},
    blocked: [],
    theme: storedTheme(),
    reading: false,
    cursor: false,
    notice: null,
    keepsake: null,

    async boot() {
      const token = getToken()
      if (!token) {
        set({ status: 'out' })
        return
      }
      try {
        const { user, token: renewed } = await api.me()
        if (renewed) setToken(renewed)
        set({ me: user, status: 'in' })
        connection.open(renewed ?? token)
      } catch {
        setToken(null)
        set({ status: 'out', me: null })
      }
    },

    async signIn(handle, password) {
      const { token, user } = await api.login(handle.toLowerCase(), password)
      land(token, user)
    },

    async signUp(handle, name, password) {
      const { token, user, recoveryPhrase } = await api.register(handle.toLowerCase(), name, password)
      land(token, user)
      // Shown once. There is no email to send it to, so it is this or nothing.
      set({ keepsake: recoveryPhrase })
    },

    async block(handle) {
      try {
        await api.block(handle)
        // The thread keeps its place and its history; it simply goes quiet.
        set({ notice: `@${handle} est bloqué` })
        await get().loadBlocked()
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'impossible de bloquer' })
      }
    },

    async unblock(handle) {
      try {
        await api.unblock(handle)
        set({ notice: `@${handle} n’est plus bloqué` })
        await get().loadBlocked()
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'impossible de débloquer' })
      }
    },

    async loadBlocked() {
      try {
        const { people } = await api.blocked()
        set({ blocked: people })
      } catch {
        // A block list that cannot be read is not worth a notice.
      }
    },

    async recover(handle, phrase, password) {
      const { token, user, recoveryPhrase } = await api.recover(handle.toLowerCase(), phrase, password)
      land(token, user)
      set({ keepsake: recoveryPhrase })
    },

    async changePassphrase(current, next) {
      const { token } = await api.changePassphrase(current, next)
      // Every other session just died, including this one's socket. Reconnect
      // with the token that replaced it.
      setToken(token)
      connection.close()
      connection.open(token)
      set({ notice: 'phrase secrète changée — les autres sessions sont fermées' })
    },

    async mintRecoveryPhrase() {
      const { recoveryPhrase } = await api.newRecoveryPhrase()
      set({ keepsake: recoveryPhrase, cursor: false })
    },

    async revokeEverywhere() {
      const { token } = await api.revokeSessions()
      setToken(token)
      connection.close()
      connection.open(token)
      set({ notice: 'toutes les autres sessions sont fermées', cursor: false })
    },

    keep() {
      set({ keepsake: null })
    },

    signOut() {
      connection.close()
      setToken(null)
      set({
        status: 'out',
        me: null,
        conversations: [],
        messages: {},
        hydrated: {},
        exhausted: {},
        open: null,
        replyTo: null,
        editing: null,
        typing: {},
        online: {},
        cursor: false,
        reading: false,
        keepsake: null,
        blocked: [],
      })
    },

    enter(conversationId) {
      set({ open: conversationId, replyTo: null, editing: null, cursor: false })
      void hydrate(conversationId)
      markRead(conversationId)
    },

    leave() {
      set({ open: null, replyTo: null, editing: null, reading: false })
    },

    async startWith(handle) {
      try {
        const { conversation } = await api.openConversation(handle)
        set((s) =>
          s.conversations.some((c) => c.id === conversation.id)
            ? {}
            : { conversations: reorder([conversation, ...s.conversations]) },
        )
        get().enter(conversation.id)
        return conversation.id
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'impossible d’ouvrir cela' })
        return null
      }
    },

    say(body) {
      const { open, me, replyTo } = get()
      const text = body.trim()
      if (!open || !me || !text) return

      const nonce = `pending:${crypto.randomUUID()}`
      const optimistic: Message = {
        id: nonce,
        conversationId: open,
        senderId: me.id,
        body: text,
        replyTo: replyTo?.id ?? null,
        createdAt: Date.now(),
        editedAt: null,
        deletedAt: null,
        pending: true,
      }
      absorb(optimistic)
      set({ replyTo: null })

      connection.send({
        t: 'send',
        conversation: open,
        body: text,
        replyTo: replyTo?.id ?? null,
        nonce,
      })
    },

    reply(message) {
      set({ replyTo: message, editing: null })
    },

    edit(message) {
      if (message && (message.deletedAt || message.senderId !== get().me?.id)) return
      set({ editing: message, replyTo: null })
    },

    /** Commits the rewrite, optimistically, then lets the server confirm it. */
    revise(body) {
      const { editing } = get()
      const text = body.trim()
      if (!editing || !text) return
      set({ editing: null })
      if (text === editing.body) return
      absorbRevision({ ...editing, body: text, editedAt: Date.now() })
      connection.send({ t: 'revise', message: editing.id, body: text })
    },

    retract(message) {
      if (message.senderId !== get().me?.id || message.pending) return
      absorbRevision({ ...message, body: '', deletedAt: Date.now() })
      connection.send({ t: 'retract', message: message.id })
    },

    /** Signals "someone is writing", at most once per second. */
    breathe() {
      const { open } = get()
      const now = Date.now()
      if (!open || now - typingSentAt < 1000) return
      typingSentAt = now
      connection.send({ t: 'typing', conversation: open })
    },

    async older() {
      const { open, messages, exhausted } = get()
      if (!open || exhausted[open]) return
      const first = messages[open]?.[0]
      if (!first) return
      try {
        const { messages: batch } = await api.messages(open, first.createdAt)
        set((s) => ({
          messages: { ...s.messages, [open]: [...batch, ...(s.messages[open] ?? [])] },
          exhausted: { ...s.exhausted, [open]: batch.length === 0 },
        }))
      } catch {
        set({ notice: 'impossible de remonter plus loin' })
      }
    },

    setTheme(theme) {
      localStorage.setItem('kairus.theme', theme)
      document.documentElement.dataset.theme = theme
      set({ theme })
    },

    toggleReading() {
      set((s) => ({ reading: !s.reading }))
    },

    setCursor(open) {
      set({ cursor: open })
    },

    notify(text) {
      set({ notice: text })
    },
  }
})

/** Convenience selectors — kept here so components stay declarative. */
export const useOpenConversation = () =>
  useStore((s) => s.conversations.find((c) => c.id === s.open) ?? null)

export const useThread = (conversationId: string | null): Message[] =>
  useStore((s) => (conversationId ? (s.messages[conversationId] ?? EMPTY) : EMPTY))

const EMPTY: Message[] = []
