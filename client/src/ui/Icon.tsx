import type { ReactNode } from 'react'

/*
 * The icons.
 *
 * Drawn here rather than pulled from a package: there are twenty of them, they
 * are a few hundred bytes each, and a shared stroke weight is what makes a set
 * look like a set. All of them are 24×24, stroked in `currentColor`, so an icon
 * takes the colour and the size of whatever it sits in.
 */

export type IconName =
  | 'search'
  | 'compose'
  | 'group'
  | 'settings'
  | 'back'
  | 'more'
  | 'clip'
  | 'send'
  | 'mic'
  | 'stop'
  | 'phone'
  | 'hangup'
  | 'play'
  | 'pause'
  | 'reply'
  | 'edit'
  | 'trash'
  | 'check'
  | 'checks'
  | 'close'
  | 'download'
  | 'muted'
  | 'sound'

/** The few that read better as a solid shape than as an outline. */
const SOLID = new Set<IconName>(['more', 'play'])

const shapes: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  compose: (
    <>
      <path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14.4 7.6 3 3" />
    </>
  ),
  group: (
    <>
      <circle cx="9.2" cy="8.4" r="3.4" />
      <path d="M3 19.6c0-3.1 2.8-5 6.2-5s6.2 1.9 6.2 5" />
      <path d="M16.4 5.6a3.4 3.4 0 0 1 0 6.6" />
      <path d="M17.8 15.2c2 .7 3.2 2.2 3.2 4.4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h8M17 7.5h3M4 16.5h3M12 16.5h8" />
      <circle cx="14.5" cy="7.5" r="2.3" />
      <circle cx="9.5" cy="16.5" r="2.3" />
    </>
  ),
  back: <path d="m14.5 5-7 7 7 7" />,
  more: (
    <>
      <circle cx="12" cy="5.4" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18.6" r="1.5" />
    </>
  ),
  clip: (
    <path d="M19.6 11.3 12 18.9a4.5 4.5 0 0 1-6.4-6.4l8.2-8.2a3 3 0 0 1 4.2 4.2l-8.1 8.2a1.5 1.5 0 0 1-2.1-2.1l7.4-7.5" />
  ),
  send: (
    <>
      <path d="M20.6 3.4 3.6 10a.45.45 0 0 0 0 .84l6.6 2.5 2.5 6.6a.45.45 0 0 0 .84 0z" />
      <path d="M20.6 3.4 10.2 13.3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.8" width="6" height="11.4" rx="3" />
      <path d="M5.4 11.6a6.6 6.6 0 0 0 13.2 0" />
      <path d="M12 18.2v3" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.4" />,
  phone: (
    <path d="M6.4 3.4h3l1.5 4-2 1.4a12.2 12.2 0 0 0 6.3 6.3l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.4 5.6a2 2 0 0 1 2-2.2z" />
  ),
  hangup: (
    <path d="M2.4 15.4c5.3-5 13.9-5 19.2 0l-2.4 2.4a1.6 1.6 0 0 1-2.1.1l-1.7-1.3a1.6 1.6 0 0 0-1-.35h-4.8a1.6 1.6 0 0 0-1 .35L7 17.9a1.6 1.6 0 0 1-2.1-.1z" />
  ),
  play: <path d="M8 5.2 18.8 12 8 18.8z" />,
  pause: <path d="M9.2 5.4v13.2M14.8 5.4v13.2" />,
  reply: (
    <>
      <path d="M9 6 3.6 11.4 9 16.8" />
      <path d="M3.6 11.4H14a6.6 6.6 0 0 1 6.6 6.6v1.4" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14.4 7.6 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.6h15" />
      <path d="M9.6 6.6V4.9a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.6 6.6 7.7 19a1.8 1.8 0 0 0 1.8 1.6h5a1.8 1.8 0 0 0 1.8-1.6l1.1-12.4" />
    </>
  ),
  check: <path d="m4.5 12.6 4.8 4.8L19.5 6.6" />,
  checks: (
    <>
      <path d="m2.4 12.6 4.4 4.4 8-8.8" />
      <path d="m10.6 17 8-8.8" />
    </>
  ),
  close: <path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8" />,
  download: (
    <>
      <path d="M12 3.8v11" />
      <path d="m7.6 10.6 4.4 4.4 4.4-4.4" />
      <path d="M4.6 19.6h14.8" />
    </>
  ),
  muted: (
    <>
      <path d="M11.5 4.5 6.8 8.6H3.4v6.8h3.4l4.7 4.1z" />
      <path d="m15.8 9.6 4.8 4.8M20.6 9.6l-4.8 4.8" />
    </>
  ),
  sound: (
    <>
      <path d="M11.5 4.5 6.8 8.6H3.4v6.8h3.4l4.7 4.1z" />
      <path d="M15.4 9a4.2 4.2 0 0 1 0 6" />
      <path d="M18.2 6.6a8 8 0 0 1 0 10.8" />
    </>
  ),
}

type Props = {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20 }: Props) {
  const solid = SOLID.has(name)
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[name]}
    </svg>
  )
}
