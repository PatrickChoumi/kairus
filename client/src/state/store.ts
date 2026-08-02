import { create } from 'zustand'
import { api, ApiError, getToken, setToken } from '../net/api'
import { connection, type Link } from '../net/socket'
import { disablePush, enablePush, pushState, type PushState } from '../net/push'
import { forgetAttachment, forgetAttachments } from '../net/blobs'
import { caller, canCall, type CallSnapshot } from '../net/call'
import { prepare, upload, UploadError, type Prepared } from '../net/files'
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
  /** The message waiting for somewhere to be sent on to. */
  relaying: Message | null
  /** What is about to be reported: a message, or a person by name. */
  flagging: { message: Message | null; handle: string; name: string } | null
  typing: Record<string, number>
  online: Record<string, boolean>

  blocked: User[]
  /** Whether this browser will be reached when the application is closed. */
  push: PushState
  /** The call in progress, from either end. */
  call: CallSnapshot | null

  theme: Theme
  reading: boolean
  cursor: boolean
  /** What the Cursor should already have in its field when it opens. */
  cursorSeed: string
  notice: string | null
  /** Shown once, right after it is minted, and never recoverable afterwards. */
  keepsake: string | null
  /** Whether a second factor stands between the passphrase and the account. */
  factor: boolean
  /** The secret being set up, while it is being set up. */
  arming: { secret: string; readable: string; uri: string } | null
}

type Actions = {
  boot: () => Promise<void>
  signIn: (handle: string, password: string, code?: string) => Promise<void>
  signUp: (handle: string, name: string, password: string) => Promise<void>
  signOut: () => void

  enter: (conversationId: string) => void
  leave: () => void
  startWith: (handle: string) => Promise<string | null>
  gather: (title: string, handles: string[]) => Promise<void>
  invite: (conversationId: string, handle: string) => Promise<void>
  leaveGroup: (conversationId: string) => Promise<void>
  renameGroup: (conversationId: string, title: string) => Promise<void>

  say: (body: string) => void
  /**
   * Sends one or more files, each as its own message. A voice message arrives
   * here already prepared — it was recorded, not chosen.
   */
  attach: (files: (File | Prepared)[], caption?: string) => Promise<void>
  reply: (message: Message | null) => void
  edit: (message: Message | null) => void
  revise: (body: string) => void
  retract: (message: Message) => void
  breathe: () => void
  older: () => Promise<void>

  /** Picks a message up; `relayTo` puts it down somewhere else. */
  relay: (message: Message | null) => void
  relayTo: (conversationId: string) => void
  pin: (message: Message, pinned: boolean) => void
  /** Picks something up to report; `flagWith` files it with a reason. */
  flag: (target: { message: Message | null; handle: string; name: string } | null) => void
  flagWith: (reason: string) => Promise<void>
  expel: (conversationId: string, handle: string) => Promise<void>
  /** Saves what is being written so another device finds it. */
  sketch: (conversationId: string, body: string) => void

  refreshPush: () => Promise<void>
  togglePush: () => Promise<void>

  ringUp: (conversationId: string) => void
  answerCall: () => void
  hangUp: () => void
  toggleMute: () => void

  block: (handle: string) => Promise<void>
  unblock: (handle: string) => Promise<void>
  loadBlocked: () => Promise<void>

  loadFactor: () => Promise<void>
  /** Mints a secret. Nothing is in force until `confirmFactor` proves it arrived. */
  armFactor: (password: string) => Promise<void>
  confirmFactor: (code: string) => Promise<void>
  disarmFactor: (password: string, code: string) => Promise<void>
  dropArming: () => void

  recover: (handle: string, phrase: string, password: string) => Promise<void>
  changePassphrase: (current: string, next: string) => Promise<void>
  mintRecoveryPhrase: () => Promise<void>
  revokeEverywhere: () => Promise<void>
  keep: () => void

  setTheme: (theme: Theme) => void
  toggleReading: () => void
  setCursor: (open: boolean, seed?: string) => void
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

/**
 * A notification raised by the page itself. The server only pushes to people
 * with no live socket; a backgrounded tab still has one, so without this a
 * hidden tab would stay silent.
 */
function announce(message: Message, conversations: Conversation[]): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const conversation = conversations.find((c) => c.id === message.conversationId)
  const speaker = conversation?.members.find((m) => m.id === message.senderId)
  // In a group the title is the notification; who spoke belongs in the body.
  const from = conversation?.face.name ?? 'Kairus'
  const mime = message.attachment?.mime ?? ''
  const words =
    message.body ||
    (mime.startsWith('audio/')
      ? 'message vocal'
      : mime.startsWith('image/')
        ? 'photo'
        : mime
          ? 'fichier'
          : '')
  const said = conversation?.kind === 'group' && speaker ? `${speaker.name} : ${words}` : words
  try {
    new Notification(from, {
      body: said.slice(0, 180),
      icon: '/mark.svg',
      tag: `kairus-${message.conversationId}`,
    })
  } catch {
    // Some browsers only allow this from a service worker; silence is fine.
  }
}

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

    // The socket is alive, so the server did not push: with the tab merely
    // hidden, this side is the one that has to speak up.
    if (!mine && document.visibilityState === 'hidden') announce(message, state.conversations)

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
    const previous = state.messages[message.conversationId]?.find((m) => m.id === message.id)
    // A retraction has to take the picture off this screen too, not just off
    // the server — otherwise it lingers until the tab is closed.
    if (message.deletedAt && previous?.attachment) forgetAttachment(previous.attachment.id)
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
    caller.onChange((call) => set({ call }))
    connection.onLink((link) => {
      // A call cannot survive the link it was negotiated over. Asked of the
      // caller rather than the store: this runs once while the store is still
      // being built, and `get()` is not answerable that early.
      if (link === 'offline' && caller.current) caller.dropped()
      set({ link })
    })
    connection.on((event) => {
      switch (event.t) {
        case 'ready':
          // The server swaps an ageing token here; keeping the old one would
          // mean signing in again the moment it expires.
          if (event.token) setToken(event.token)
          caller.useIceServers(event.ice)
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
                ? { ...c, readAt: Math.max(c.readAt, event.at) }
                : c,
            ),
          }))
          break

        case 'gone':
          set((s) => ({
            conversations: s.conversations.filter((c) => c.id !== event.conversation),
            open: s.open === event.conversation ? null : s.open,
          }))
          break

        case 'presence':
          set((s) => ({ online: { ...s.online, [event.userId]: event.online } }))
          break

        case 'pinned':
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === event.conversation ? { ...c, pins: event.pins } : c,
            ),
          }))
          break

        /*
         * A draft from one of your own other devices. It is stored either way,
         * but it only reaches the composer when there is nothing there to
         * overwrite — a sentence being typed here outranks one typed earlier
         * somewhere else.
         */
        case 'draft':
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === event.conversation ? { ...c, draft: event.body } : c,
            ),
          }))
          break

        case 'call':
          void caller.receive(event)
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
    relaying: null,
    flagging: null,
    typing: {},
    online: {},
    blocked: [],
    push: 'off',
    call: null,
    theme: storedTheme(),
    reading: false,
    cursor: false,
    cursorSeed: '',
    notice: null,
    keepsake: null,
    factor: false,
    arming: null,

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

    async signIn(handle, password, code) {
      const { token, user } = await api.login(handle.toLowerCase(), password, code)
      land(token, user)
    },

    async signUp(handle, name, password) {
      const { token, user, recoveryPhrase } = await api.register(handle.toLowerCase(), name, password)
      land(token, user)
      // Shown once. There is no email to send it to, so it is this or nothing.
      set({ keepsake: recoveryPhrase })
    },

    async refreshPush() {
      set({ push: await pushState() })
    },

    async togglePush() {
      const before = get().push
      try {
        const after = before === 'on' ? await disablePush() : await enablePush()
        set({ push: after, cursor: false })
        const said: Record<PushState, string> = {
          on: 'vous serez prévenu même l’application fermée',
          off: 'notifications désactivées',
          refused: 'le navigateur a refusé — à réautoriser dans ses réglages',
          failed: 'le navigateur n’a pas pu s’abonner — navigation privée ?',
          unsupported: 'ce navigateur ne sait pas recevoir de notifications',
          unconfigured: 'les notifications ne sont pas configurées sur ce serveur',
        }
        set({ notice: said[after] })
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'impossible pour l’instant' })
      }
    },

    /** Calls are one to one: a group has no single person to ring. */
    ringUp(conversationId) {
      const conversation = get().conversations.find((c) => c.id === conversationId)
      const peer = conversation?.members[0]
      if (!conversation || conversation.kind !== 'direct' || !peer) return
      if (!canCall()) {
        set({ notice: 'ce navigateur ne sait pas passer d’appel' })
        return
      }
      if (!get().online[peer.id]) {
        set({ notice: `${peer.name} n’est pas connecté` })
        return
      }
      void caller.place(conversationId, peer.id)
    },

    answerCall() {
      void caller.accept()
    },

    hangUp() {
      caller.hangUp()
    },

    toggleMute() {
      caller.toggleMute()
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

    async loadFactor() {
      try {
        const { on } = await api.totpState()
        set({ factor: on })
      } catch {
        // Not knowing is not worth a notice; the command simply offers both.
      }
    },

    async armFactor(password) {
      try {
        const arming = await api.totpBegin(password)
        set({ arming, cursor: false })
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'impossible pour l’instant' })
      }
    },

    async confirmFactor(code) {
      await api.totpConfirm(code)
      set({ arming: null, factor: true, notice: 'la double authentification est active' })
    },

    async disarmFactor(password, code) {
      try {
        await api.totpOff(password, code)
        set({ factor: false, cursor: false, notice: 'la double authentification est désactivée' })
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'impossible pour l’instant' })
      }
    },

    dropArming() {
      set({ arming: null })
    },

    async recover(handle, phrase, password) {
      const { token, user, recoveryPhrase } = await api.recover(handle.toLowerCase(), phrase, password)
      land(token, user)
      // The server lifts the second factor on recovery; this side must agree.
      set({ keepsake: recoveryPhrase, factor: false, arming: null })
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
      caller.hangUp()
      connection.close()
      forgetAttachments()
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
        relaying: null,
        flagging: null,
        typing: {},
        online: {},
        cursor: false,
        reading: false,
        keepsake: null,
        blocked: [],
        factor: false,
        arming: null,
      })
    },

    enter(conversationId) {
      set({
        open: conversationId,
        replyTo: null,
        editing: null,
        relaying: null,
        flagging: null,
        cursor: false,
      })
      void hydrate(conversationId)
      markRead(conversationId)
    },

    leave() {
      set({ open: null, replyTo: null, editing: null, relaying: null, reading: false })
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

    /** Starts a group. Handles are taken as written, minus any leading @. */
    async gather(title, handles) {
      const { conversation } = await api.createGroup(
        title,
        handles.map((h) => h.replace(/^@/, '').trim().toLowerCase()).filter(Boolean),
      )
      set((s) =>
        s.conversations.some((c) => c.id === conversation.id)
          ? {}
          : { conversations: reorder([conversation, ...s.conversations]) },
      )
      get().enter(conversation.id)
    },

    async invite(conversationId, handle) {
      const { member } = await api.addToGroup(conversationId, handle.replace(/^@/, '').toLowerCase())
      set({ notice: `${member.name} a rejoint le groupe` })
    },

    async leaveGroup(conversationId) {
      await api.leaveGroup(conversationId)
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== conversationId),
        open: s.open === conversationId ? null : s.open,
        cursor: false,
      }))
    },

    async renameGroup(conversationId, title) {
      const renamed = await api.renameGroup(conversationId, title)
      set({ notice: `le groupe s’appelle « ${renamed.title} »` })
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
        attachment: null,
        forwarded: null,
        pending: true,
      }
      absorb(optimistic)
      set({ replyTo: null })
      get().sketch(open, '')

      connection.send({
        t: 'send',
        conversation: open,
        body: text,
        replyTo: replyTo?.id ?? null,
        nonce,
      })
    },

    /**
     * A file goes up first, then the message that carries it. The bubble
     * appears immediately with a local preview and a progress figure, so the
     * wait happens inside the conversation rather than in front of it.
     */
    async attach(files, caption) {
      const { open, me } = get()
      if (!open || !me || files.length === 0) return

      for (const [index, file] of files.entries()) {
        const nonce = `pending:${crypto.randomUUID()}`
        let preview: string | undefined
        try {
          const prepared = file instanceof File ? await prepare(file) : file
          if (/^(image|audio)\//.test(prepared.type)) {
            preview = URL.createObjectURL(prepared.blob)
          }

          absorb({
            id: nonce,
            conversationId: open,
            senderId: me.id,
            // Only the first of a batch carries what was written.
            body: index === 0 ? (caption ?? '').trim() : '',
            replyTo: null,
            createdAt: Date.now(),
            editedAt: null,
            deletedAt: null,
            attachment: {
              id: nonce,
              name: prepared.name,
              mime: prepared.type,
              size: prepared.blob.size,
              width: prepared.width,
              height: prepared.height,
              duration: prepared.duration ?? null,
              peaks: prepared.peaks?.join(',') ?? null,
            },
            forwarded: null,
            pending: true,
            progress: 0,
            preview,
          })

          const attachment = await upload(prepared, (fraction) => {
            const list = get().messages[open] ?? []
            set({
              messages: {
                ...get().messages,
                [open]: list.map((m) => (m.id === nonce ? { ...m, progress: fraction } : m)),
              },
            })
          })

          connection.send({
            t: 'send',
            conversation: open,
            body: index === 0 ? (caption ?? '').trim() : '',
            replyTo: null,
            nonce,
            attachment: attachment.id,
          })
        } catch (problem) {
          if (preview) URL.revokeObjectURL(preview)
          // Drop the hopeful bubble rather than leave it stuck at 40%.
          const list = get().messages[open] ?? []
          set({
            messages: { ...get().messages, [open]: list.filter((m) => m.id !== nonce) },
            notice: problem instanceof UploadError ? problem.message : 'l’envoi a échoué',
          })
        }
      }
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

    relay(message) {
      if (message?.pending || message?.deletedAt) return
      set({ relaying: message })
    },

    /**
     * Sends the held message on. No optimistic copy: the server decides what
     * a forward becomes — who it credits, and whether the file could be
     * copied — so guessing here would only mean showing a wrong bubble first.
     */
    relayTo(conversationId) {
      const { relaying } = get()
      if (!relaying) return
      set({ relaying: null })
      connection.send({
        t: 'forward',
        conversation: conversationId,
        message: relaying.id,
        nonce: `pending:${crypto.randomUUID()}`,
      })
      const target = get().conversations.find((c) => c.id === conversationId)
      set({ notice: target ? `transféré à ${target.face.name}` : 'transféré' })
    },

    pin(message, pinned) {
      const conversationId = message.conversationId
      if (message.pending || message.deletedAt) return
      // The server answers with the whole pin list, so nothing is guessed here.
      connection.send({
        t: pinned ? 'pin' : 'unpin',
        conversation: conversationId,
        message: message.id,
      })
    },

    flag(target) {
      set({ flagging: target })
    },

    /**
     * Files it. There is no optimistic anything: a report either reached the
     * server or it did not, and saying "signalé" for one that never arrived
     * would be the worst possible lie to tell someone being harassed.
     */
    async flagWith(reason) {
      const target = get().flagging
      if (!target) return
      try {
        await api.report(
          target.message ? { message: target.message.id } : { handle: target.handle },
          reason,
        )
        set({ flagging: null, notice: 'signalé — c’est enregistré' })
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'le signalement n’est pas parti' })
      }
    },

    async expel(conversationId, handle) {
      try {
        const { removed } = await api.removeFromGroup(conversationId, handle.replace(/^@/, ''))
        set({ notice: `${removed.name} ne fait plus partie du groupe` })
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : 'impossible de retirer' })
      }
    },

    sketch(conversationId, body) {
      const known = get().conversations.find((c) => c.id === conversationId)
      if (!known || known.draft === body) return
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversationId ? { ...c, draft: body } : c,
        ),
      }))
      connection.send({ t: 'draft', conversation: conversationId, body })
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

    setCursor(open, seed = '') {
      set({ cursor: open, cursorSeed: open ? seed : '' })
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
