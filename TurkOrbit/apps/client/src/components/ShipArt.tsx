import { useId, type ReactElement } from 'react';

/**
 * Türk Orbit gemileri — özgün 2.5D (hafif açılı üstten) çizimler.
 * Her gemi tek parça siluettir: gövde + kanat + kokpit + motorlar; şirket renginde motor ışıması ve şeritler.
 * spriteKey biçimi: "ship-<kod>" veya tasarım için "ship-<kod>-<palet>" (gece, bozkir, altin).
 * Aşama 7'de oyun içi sprite atlası aynı şekil tanımlarından üretilecek.
 */

interface ShipShape {
  wings: string;
  hull: string;
  cockpit: [number, number, number, number];
  engines: Array<[number, number]>;
  stripes: string[];
  extra?: 'ring' | 'fangs' | 'pods' | 'canard' | 'plates';
}

const SHAPES: Record<string, ShipShape> = {
  kirlangic: {
    wings: 'M100 52 L168 128 L150 134 L122 120 L114 150 L100 140 L86 150 L78 120 L50 134 L32 128 Z',
    hull: 'M100 18 C110 34 114 60 114 92 C114 116 110 134 100 146 C90 134 86 116 86 92 C86 60 90 34 100 18 Z',
    cockpit: [100, 58, 8, 16],
    engines: [[86, 158], [114, 158]],
    stripes: ['M58 124 L80 112 L82 118 L62 128 Z', 'M142 124 L120 112 L118 118 L138 128 Z'],
  },
  dogan: {
    wings: 'M100 64 L156 120 L140 128 L114 116 L108 140 L92 140 L86 116 L60 128 L44 120 Z',
    hull: 'M100 22 C107 40 109 64 109 92 C109 114 106 130 100 140 C94 130 91 114 91 92 C91 64 93 40 100 22 Z',
    cockpit: [100, 56, 6, 13],
    engines: [[94, 150], [106, 150]],
    stripes: ['M66 118 L84 110 L86 114 L70 122 Z', 'M134 118 L116 110 L114 114 L130 122 Z'],
  },
  atmaca: {
    wings: 'M100 92 L170 70 L176 84 L122 118 L114 146 L86 146 L78 118 L24 84 L30 70 Z',
    hull: 'M100 16 C111 34 116 62 116 96 C116 120 111 138 100 150 C89 138 84 120 84 96 C84 62 89 34 100 16 Z',
    cockpit: [100, 52, 8, 15],
    engines: [[90, 160], [110, 160]],
    stripes: ['M150 80 L168 74 L170 80 L152 86 Z', 'M50 80 L32 74 L30 80 L48 86 Z'],
    extra: 'canard',
  },
  sahin: {
    wings: 'M100 40 L128 84 L178 124 L178 136 L120 132 L110 152 L90 152 L80 132 L22 136 L22 124 L72 84 Z',
    hull: 'M100 14 C112 32 118 64 118 98 C118 122 112 140 100 152 C88 140 82 122 82 98 C82 64 88 32 100 14 Z',
    cockpit: [100, 52, 9, 16],
    engines: [[88, 162], [100, 165], [112, 162]],
    stripes: ['M150 120 L176 128 L176 132 L150 126 Z', 'M50 120 L24 128 L24 132 L50 126 Z'],
  },
  tulpar: {
    wings: 'M100 78 L182 92 L184 100 L150 108 L112 106 L106 150 L94 150 L88 106 L50 108 L16 100 L18 92 Z',
    hull: 'M100 10 C106 30 108 60 108 96 C108 122 105 140 100 154 C95 140 92 122 92 96 C92 60 94 30 100 10 Z',
    cockpit: [100, 46, 5, 14],
    engines: [[96, 162], [104, 162]],
    stripes: ['M150 95 L180 95 L180 98 L150 100 Z', 'M50 95 L20 95 L20 98 L50 100 Z'],
  },
  kartal: {
    wings:
      'M100 54 L184 116 L172 122 L180 130 L162 132 L170 140 L120 124 L112 152 L88 152 L80 124 L30 140 L38 132 L20 130 L28 122 L16 116 Z',
    hull: 'M100 16 C112 34 118 66 118 100 C118 124 112 142 100 154 C88 142 82 124 82 100 C82 66 88 34 100 16 Z',
    cockpit: [100, 54, 9, 16],
    engines: [[88, 162], [112, 162]],
    stripes: ['M140 104 L176 120 L174 124 L138 110 Z', 'M60 104 L24 120 L26 124 L62 110 Z'],
  },
  umay: {
    wings: 'M100 64 L152 100 L146 132 L112 122 L106 146 L94 146 L88 122 L54 132 L48 100 Z',
    hull: 'M100 22 C110 38 114 62 114 92 C114 116 110 132 100 144 C90 132 86 116 86 92 C86 62 90 38 100 22 Z',
    cockpit: [100, 56, 9, 14],
    engines: [[92, 156], [108, 156]],
    stripes: ['M58 104 L80 98 L80 104 L60 110 Z', 'M142 104 L120 98 L120 104 L140 110 Z'],
    extra: 'ring',
  },
  kale: {
    wings: 'M64 54 L136 54 L176 98 L176 140 L130 152 L70 152 L24 140 L24 98 Z',
    hull: 'M88 18 L112 18 L124 56 L124 144 L76 144 L76 56 Z',
    cockpit: [100, 44, 10, 10],
    engines: [[80, 160], [100, 162], [120, 160]],
    stripes: ['M30 104 L60 92 L60 100 L30 112 Z', 'M170 104 L140 92 L140 100 L170 112 Z'],
    extra: 'plates',
  },
  akinci: {
    wings: 'M100 30 L178 142 L138 130 L122 152 L78 152 L62 130 L22 142 Z',
    hull: 'M100 12 C110 32 114 62 114 98 C114 124 110 142 100 154 C90 142 86 124 86 98 C86 62 90 32 100 12 Z',
    cockpit: [100, 52, 8, 15],
    engines: [[84, 162], [96, 165], [104, 165], [116, 162]],
    stripes: ['M70 124 L90 112 L92 118 L74 128 Z', 'M130 124 L110 112 L108 118 L126 128 Z'],
    extra: 'pods',
  },
  boru: {
    wings: 'M100 60 L188 112 L168 120 L180 140 L132 128 L118 156 L82 156 L68 128 L20 140 L32 120 L12 112 Z',
    hull: 'M100 14 C113 34 120 66 120 100 C120 126 113 144 100 156 C87 144 80 126 80 100 C80 66 87 34 100 14 Z',
    cockpit: [100, 56, 9, 15],
    engines: [[84, 164], [100, 167], [116, 164]],
    stripes: ['M150 110 L184 112 L168 118 Z', 'M50 110 L16 112 L32 118 Z'],
    extra: 'fangs',
  },
};

const PALETTES: Record<string, { hull: [string, string, string]; wing: [string, string] }> = {
  default: { hull: ['#eef3ff', '#9fb0d3', '#3b4766'], wing: ['#8fa0c4', '#252e48'] },
  gece: { hull: ['#8a96bb', '#2f3a5c', '#0b1022'], wing: ['#3a4466', '#070b18'] },
  bozkir: { hull: ['#f6e7c8', '#c9a46a', '#6b4a22'], wing: ['#b38a52', '#3d2a12'] },
  altin: { hull: ['#fff3c4', '#f2c14e', '#8a5a00'], wing: ['#d9a62e', '#5a3a00'] },
};

export function shipCodeFromSprite(spriteKey: string): string {
  return /^ship-([a-z]+)/.exec(spriteKey)?.[1] ?? '';
}

export function ShipArt({ spriteKey, color = '#29c5ff', size = 160 }: { spriteKey: string; color?: string; size?: number }) {
  const id = useId().replace(/:/g, '');
  const m = /^ship-([a-z]+)(?:-([a-z]+))?$/.exec(spriteKey);
  const shape = m ? SHAPES[m[1]!] : undefined;
  if (!shape) return <div className="ship-art-missing" style={{ width: size, height: size }} aria-hidden="true" />;
  const pal = PALETTES[m?.[2] ?? 'default'] ?? PALETTES.default!;
  const [cx, cy, rx, ry] = shape.cockpit;
  const hullFill = `url(#${id}-hull)`;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Gemi" className="ship-art">
      <defs>
        <linearGradient id={`${id}-hull`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={pal.hull[0]} />
          <stop offset="0.45" stopColor={pal.hull[1]} />
          <stop offset="1" stopColor={pal.hull[2]} />
        </linearGradient>
        <linearGradient id={`${id}-wing`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={pal.wing[0]} />
          <stop offset="1" stopColor={pal.wing[1]} />
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
      <ellipse cx="106" cy="172" rx="70" ry="12" fill="#000" opacity="0.35" />
      {shape.extra === 'ring' && (
        <ellipse cx="100" cy="98" rx="76" ry="70" fill="none" stroke={color} strokeWidth="3" strokeOpacity="0.45" strokeDasharray="10 6" />
      )}
      {shape.engines.map(([x, y]) => (
        <circle key={`g${x}`} cx={x} cy={y} r="14" fill={`url(#${id}-glow)`} />
      ))}
      {shape.extra === 'pods' && (
        <g fill={hullFill} stroke="#0d1530" strokeWidth="1.5">
          <rect x="50" y="98" width="12" height="40" rx="5" />
          <rect x="138" y="98" width="12" height="40" rx="5" />
        </g>
      )}
      <path d={shape.wings} fill={`url(#${id}-wing)`} stroke="#0d1530" strokeWidth="2" strokeLinejoin="round" />
      <path d={shape.wings} fill="#ffffff" opacity="0.06" transform="translate(-2 -2)" />
      {shape.stripes.map((d) => (
        <path key={d} d={d} fill={color} opacity="0.9" />
      ))}
      {shape.extra === 'canard' && (
        <path d="M100 46 L126 60 L124 66 L100 60 L76 66 L74 60 Z" fill={`url(#${id}-wing)`} stroke="#0d1530" strokeWidth="1.5" />
      )}
      {shape.extra === 'fangs' && (
        <g fill={hullFill} stroke="#0d1530" strokeWidth="1.5">
          <path d="M86 28 L95 62 L84 66 Z" />
          <path d="M114 28 L105 62 L116 66 Z" />
        </g>
      )}
      <path d={shape.hull} fill={hullFill} stroke="#0d1530" strokeWidth="2" strokeLinejoin="round" />
      {shape.extra === 'plates' ? (
        <path d="M80 70 L120 70 M80 92 L120 92 M80 114 L120 114 M80 134 L120 134" stroke="#2a3552" strokeWidth="2" opacity="0.8" />
      ) : (
        <path d={`M${cx - 9} ${cy + 42} L${cx + 9} ${cy + 42} M${cx - 8} ${cy + 58} L${cx + 8} ${cy + 58}`} stroke="#2a3552" strokeWidth="1.5" opacity="0.7" />
      )}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id}-glass)`} stroke="#0d1530" strokeWidth="1.5" />
      {shape.engines.map(([x, y]) => (
        <rect key={`e${x}`} x={x - 6} y={y - 18} width="12" height="9" rx="3" fill="#1b2238" stroke="#0d1530" />
      ))}
    </svg>
  );
}

/** Eşya kategorisi simgeleri (özgün, sade çizimler). */
export function ItemIcon({ iconKey, size = 40, color = '#29c5ff' }: { iconKey: string; size?: number; color?: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const glyph: Record<string, ReactElement> = {
    laser: <g {...common}><rect x="6" y="15" width="16" height="10" rx="2" /><path d="M22 20 H34" /><path d="M28 14 L34 20 L28 26" opacity=".6" /></g>,
    ammo: <g {...common}><rect x="11" y="8" width="7" height="24" rx="3" /><rect x="22" y="8" width="7" height="24" rx="3" /><path d="M11 14 H18 M22 14 H29" /></g>,
    rocket: <g {...common}><path d="M20 5 C26 11 26 23 23 30 H17 C14 23 14 11 20 5 Z" /><path d="M17 30 L13 35 M23 30 L27 35" /><circle cx="20" cy="15" r="2.5" /></g>,
    launcher: <g {...common}><rect x="7" y="12" width="26" height="16" rx="3" /><circle cx="14" cy="20" r="2.5" /><circle cx="20" cy="20" r="2.5" /><circle cx="26" cy="20" r="2.5" /></g>,
    shield: <g {...common}><path d="M20 5 L32 10 V20 C32 27 26 32 20 35 C14 32 8 27 8 20 V10 Z" /><path d="M14 20 L18 24 L26 15" /></g>,
    speed: <g {...common}><path d="M6 14 H20 M4 20 H24 M6 26 H20" /><path d="M24 10 L34 20 L24 30" /></g>,
    cargo: <g {...common}><path d="M8 13 L20 7 L32 13 V27 L20 33 L8 27 Z" /><path d="M8 13 L20 19 L32 13 M20 19 V33" /></g>,
    repair: <g {...common}><path d="M26 8 A7 7 0 0 0 18 17 L8 27 L13 32 L23 22 A7 7 0 0 0 32 14 L27 17 L23 13 Z" /></g>,
    radar: <g {...common}><circle cx="20" cy="20" r="13" /><circle cx="20" cy="20" r="7" opacity=".6" /><path d="M20 20 L30 11" /></g>,
    drone: <g {...common}><circle cx="20" cy="20" r="5" /><path d="M15 15 L9 9 M25 15 L31 9 M15 25 L9 31 M25 25 L31 31" /><circle cx="8" cy="8" r="3" /><circle cx="32" cy="8" r="3" /><circle cx="8" cy="32" r="3" /><circle cx="32" cy="32" r="3" /></g>,
    pet: <g {...common}><rect x="9" y="12" width="22" height="18" rx="6" /><circle cx="16" cy="21" r="2" /><circle cx="24" cy="21" r="2" /><path d="M20 12 V6 M17 6 H23" /></g>,
    petmod: <g {...common}><rect x="9" y="9" width="22" height="22" rx="4" /><path d="M14 4 V9 M20 4 V9 M26 4 V9 M14 31 V36 M20 31 V36 M26 31 V36" /><rect x="15" y="15" width="10" height="10" rx="2" /></g>,
    bundle: <g {...common}><rect x="7" y="15" width="26" height="18" rx="3" /><path d="M5 11 H35 V15 H5 Z" /><path d="M20 11 V33" /><path d="M20 11 C16 4 10 6 13 10 M20 11 C24 4 30 6 27 10" /></g>,
    resource: <g {...common}><path d="M20 6 L27 18 L20 33 L13 18 Z" /><path d="M13 18 H27" /><path d="M10 24 L14 19 M30 24 L26 19" opacity=".6" /></g>,
    design: <g {...common}><path d="M20 6 C28 6 34 12 34 19 C34 24 30 25 27 24 C24 23 23 26 24 29 C25 33 22 34 20 34 C12 34 6 28 6 20 C6 12 12 6 20 6 Z" /><circle cx="14" cy="16" r="2" /><circle cx="22" cy="12" r="2" /><circle cx="28" cy="17" r="2" /></g>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="item-icon">
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#0a1129" stroke="#23305e" />
      {glyph[iconKey] ?? (iconKey.startsWith('res-') ? glyph.resource : <circle cx="20" cy="20" r="8" {...common} />)}
    </svg>
  );
}
