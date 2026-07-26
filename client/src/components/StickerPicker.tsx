import { useState, useRef, useEffect } from 'react';

const STICKERS = [
  { id: '1', emoji: '😊' }, { id: '2', emoji: '😂' }, { id: '3', emoji: '❤️' },
  { id: '4', emoji: '🔥' }, { id: '5', emoji: '👍' }, { id: '6', emoji: '🎉' },
  { id: '7', emoji: '😎' }, { id: '8', emoji: '🤔' }, { id: '9', emoji: '💀' },
  { id: '10', emoji: '🙏' }, { id: '11', emoji: '💯' }, { id: '12', emoji: '✨' },
];

const EMOJIS = ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😗','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤧','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏'];

interface Props {
  onSelect: (text: string) => void;
  onClose: () => void;
}

export default function StickerPicker({ onSelect, onClose }: Props) {
  const [tab, setTab] = useState<'emoji' | 'sticker'>('emoji');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="absolute bottom-full left-0 mb-2 w-72 bg-white dark:bg-dark-secondary rounded-2xl shadow-2xl border border-tertiary dark:border-dark-tertiary overflow-hidden z-50">
      <div className="flex border-b border-tertiary dark:border-dark-tertiary">
        <button onClick={() => setTab('emoji')} className={`flex-1 py-2 text-sm font-medium ${tab === 'emoji' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'}`}>Emoji</button>
        <button onClick={() => setTab('sticker')} className={`flex-1 py-2 text-sm font-medium ${tab === 'sticker' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'}`}>Stickers</button>
      </div>
      <div className="p-2 max-h-60 overflow-y-auto">
        {tab === 'emoji' ? (
          <div className="grid grid-cols-8 gap-1">
            {EMOJIS.map(e => (
              <button key={e} onClick={() => onSelect(e)} className="w-8 h-8 flex items-center justify-center hover:bg-tertiary dark:hover:bg-dark-tertiary rounded-lg text-lg">{e}</button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {STICKERS.map(s => (
              <button key={s.id} onClick={() => onSelect(s.emoji)} className="p-3 hover:bg-tertiary dark:hover:bg-dark-tertiary rounded-xl text-3xl">{s.emoji}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
