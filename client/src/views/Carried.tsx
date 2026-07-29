import { useAttachment } from '../net/blobs'
import { isImage, keepFile, readableSize } from '../net/files'
import type { Attachment, Message } from '../net/types'

type Props = {
  message: Message
  onOpen: (attachment: Attachment, url: string) => void
}

/**
 * What a message is carrying.
 *
 * An image keeps its own proportions from the moment it appears — the
 * dimensions travel with the attachment, so the bubble is the right size
 * before a single byte of the picture has arrived and the thread never jumps
 * under the reader.
 */
export function Carried({ message, onOpen }: Props) {
  const attachment = message.attachment
  // While it is still uploading, the local copy stands in for the remote one.
  const remote = useAttachment(attachment && !message.pending ? attachment.id : null)
  const url = message.preview ?? remote.url

  if (!attachment) return null

  if (!isImage(attachment.mime)) {
    return (
      <button
        className="carried carried--file"
        type="button"
        onClick={() => void keepFile(attachment)}
        disabled={Boolean(message.pending)}
      >
        <span className="carried__glyph" aria-hidden="true">
          ↓
        </span>
        <span className="carried__about">
          <span className="carried__name">{attachment.name}</span>
          <span className="carried__size">
            {message.pending
              ? `${Math.round((message.progress ?? 0) * 100)} %`
              : readableSize(attachment.size)}
          </span>
        </span>
      </button>
    )
  }

  const ratio =
    attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3

  return (
    <div
      className="carried carried--image"
      style={{ aspectRatio: String(ratio) }}
      data-loading={!url || undefined}
    >
      {url ? (
        <img
          src={url}
          alt={attachment.name}
          draggable={false}
          onClick={() => !message.pending && onOpen(attachment, url)}
        />
      ) : (
        <span className="carried__waiting" aria-label="chargement" />
      )}

      {message.pending && (
        <span className="carried__progress" style={{ ['--done' as string]: message.progress ?? 0 }}>
          <span />
        </span>
      )}

      {remote.failed && <span className="carried__lost">image indisponible</span>}
    </div>
  )
}
