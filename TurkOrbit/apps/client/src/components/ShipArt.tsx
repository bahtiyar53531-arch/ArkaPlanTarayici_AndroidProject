import { useId } from 'react';

/**
 * Kırlangıç — Türk Orbit başlangıç gemisi (özgün çizim).
 * Hafif açılı üstten 2.5D görünüm: tek parça siluet, çatal kuyruk, şirket renginde motor ışıması.
 * Aşama 7'de oyun içi sprite atlasıyla aynı tasarım dili kullanılacak.
 */
export function ShipArt({ spriteKey, color = '#29c5ff', size = 160 }: { spriteKey: string; color?: string; size?: number }) {
  const id = useId().replace(/:/g, '');
  if (spriteKey !== 'ship-kirlangic') {
    return <div className="ship-art-missing" style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Kırlangıç gemisi" className="ship-art">
      <defs>
        <linearGradient id={`${id}-hull`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#eef3ff" />
          <stop offset="0.45" stopColor="#9fb0d3" />
          <stop offset="1" stopColor="#3b4766" />
        </linearGradient>
        <linearGradient id={`${id}-wing`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8fa0c4" />
          <stop offset="1" stopColor="#252e48" />
        </linearGradient>
        <radialGradient id={`${id}-glass`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#e8fbff" />
          <stop offset="0.35" stopColor="#5fd4ff" />
          <stop offset="1" stopColor="#0b3a5a" />
        </radialGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* zemine düşen gölge (2.5D derinlik) */}
      <ellipse cx="106" cy="168" rx="66" ry="12" fill="#000" opacity="0.35" />
      {/* motor ışımaları */}
      <circle cx="86" cy="160" r="15" fill={`url(#${id}-glow)`} />
      <circle cx="114" cy="160" r="15" fill={`url(#${id}-glow)`} />
      {/* kanatlar: geriye süpürülmüş, uçları çatal kuyruğa bağlanan tek parça */}
      <path
        d="M100 52 L168 128 L150 134 L122 120 L114 150 L100 140 L86 150 L78 120 L50 134 L32 128 Z"
        fill={`url(#${id}-wing)`}
        stroke="#0d1530"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* kanat üst yüzeyi ışığı */}
      <path d="M100 60 L156 124 L146 127 L100 76 Z" fill="#ffffff" opacity="0.12" />
      {/* şirket rengi kanat şeritleri */}
      <path d="M58 124 L80 112 L82 118 L62 128 Z" fill={color} opacity="0.9" />
      <path d="M142 124 L120 112 L118 118 L138 128 Z" fill={color} opacity="0.9" />
      {/* gövde */}
      <path
        d="M100 18 C110 34 114 60 114 92 C114 116 110 134 100 146 C90 134 86 116 86 92 C86 60 90 34 100 18 Z"
        fill={`url(#${id}-hull)`}
        stroke="#0d1530"
        strokeWidth="2"
      />
      {/* zırh plaka çizgileri */}
      <path d="M90 98 L110 98 M91 114 L109 114" stroke="#2a3552" strokeWidth="1.5" opacity="0.7" />
      {/* kokpit */}
      <ellipse cx="100" cy="58" rx="8" ry="16" fill={`url(#${id}-glass)`} stroke="#0d1530" strokeWidth="1.5" />
      {/* motor çıkışları */}
      <rect x="80" y="140" width="12" height="9" rx="3" fill="#1b2238" stroke="#0d1530" />
      <rect x="108" y="140" width="12" height="9" rx="3" fill="#1b2238" stroke="#0d1530" />
    </svg>
  );
}
