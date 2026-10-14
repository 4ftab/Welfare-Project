/**
 * Hand-built SVG scene for the hero: a village at golden hour. Each layer drifts a
 * little with the pointer (--px / --py are set on the hero by useAmbient), so the
 * scene gains depth without any images to download.
 */

const WINDOWS = [
  [82, 322], [96, 322], [152, 316], [206, 326], [284, 324], [318, 324], [380, 322],
  [396, 322], [444, 322], [502, 320], [522, 320],
];

const FIREFLIES = [
  [92, 372, 0], [168, 398, 1.4], [246, 366, 0.7], [352, 404, 2.1],
  [452, 380, 0.4], [540, 398, 1.8], [584, 352, 2.6], [30, 408, 3],
];

export default function Village() {
  return (
    <svg className="village" viewBox="0 0 640 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A village at golden hour with fields, homes and a mosque">
      <defs>
        <radialGradient id="vg-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe9a8" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#f5b942" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#f5b942" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="vg-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff6d6" />
          <stop offset="100%" stopColor="#f7c85a" />
        </linearGradient>
        <linearGradient id="vg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a4f45" stopOpacity="0" />
          <stop offset="70%" stopColor="#1f9a85" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f2c46b" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="vg-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1b8a78" />
          <stop offset="100%" stopColor="#0d5d51" />
        </linearGradient>
        <linearGradient id="vg-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b6a58" />
          <stop offset="100%" stopColor="#063d34" />
        </linearGradient>
        <linearGradient id="vg-field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a5846" />
          <stop offset="100%" stopColor="#042a24" />
        </linearGradient>
      </defs>

      <rect x="-80" width="800" height="520" fill="url(#vg-sky)" />

      <g className="vl vl-sun">
        <circle cx="420" cy="262" r="210" fill="url(#vg-halo)" />
        <circle cx="420" cy="262" r="56" fill="url(#vg-sun)" />
      </g>

      <g className="vl vl-birds" fill="none" stroke="#fff6d6" strokeOpacity="0.75" strokeWidth="1.6" strokeLinecap="round">
        <path className="bird b1" d="M120 150 q6 -7 12 0 q6 -7 12 0" />
        <path className="bird b2" d="M170 120 q5 -6 10 0 q5 -6 10 0" />
        <path className="bird b3" d="M92 108 q4 -5 8 0 q4 -5 8 0" />
      </g>

      <g className="vl vl-far">
        <path d="M-80 300 C-10 248 170 272 250 286 S400 248 470 270 S590 252 720 276 V520 H-80Z" fill="url(#vg-far)" opacity="0.8" />
      </g>

      <g className="vl vl-mid">
        <path d="M-80 344 C0 316 160 338 250 332 S420 298 520 326 S610 322 720 314 V520 H-80Z" fill="url(#vg-mid)" />

        {/* village skyline */}
        <g fill="#04302a">
          {/* trees */}
          <circle cx="40" cy="328" r="17" /><circle cx="56" cy="334" r="13" /><rect x="46" y="338" width="3" height="10" />
          <circle cx="566" cy="322" r="18" /><circle cx="584" cy="330" r="13" /><rect x="574" y="336" width="3" height="10" />
          <circle cx="232" cy="334" r="11" />

          {/* houses */}
          <rect x="70" y="312" width="60" height="32" /><rect x="68" y="308" width="64" height="5" />
          <rect x="140" y="302" width="46" height="42" /><rect x="138" y="298" width="50" height="5" />
          <polygon points="196,344 196,320 218,300 240,320 240,344" />
          <rect x="372" y="308" width="52" height="36" /><rect x="370" y="304" width="56" height="5" />
          <polygon points="434,344 434,324 456,308 478,324 478,344" />
          <rect x="488" y="310" width="58" height="34" /><rect x="486" y="306" width="62" height="5" />

          {/* mosque: hall, dome, finial, minarets */}
          <rect x="270" y="316" width="84" height="28" />
          <path d="M282 316 A20 20 0 0 1 322 316Z" />
          <rect x="301" y="284" width="2" height="14" />
          <circle cx="302" cy="282" r="3.2" />
          <rect x="262" y="272" width="9" height="72" /><polygon points="260,272 273,272 266.5,256" /><rect x="259" y="290" width="15" height="3" />
          <rect x="353" y="272" width="9" height="72" /><polygon points="351,272 364,272 357.5,256" /><rect x="350" y="290" width="15" height="3" />
          <path d="M294 344 v-12 a8 8 0 0 1 16 0 v12Z" fill="#0b6a58" opacity="0.6" />
        </g>

        {/* lit windows */}
        <g fill="#ffd978">
          {WINDOWS.map(([x, y], i) => (
            <rect key={i} className="win" style={{ "--d": `${(i % 5) * 0.7}s` }} x={x} y={y} width="6" height="9" rx="1" />
          ))}
        </g>
      </g>

      <g className="vl vl-near">
        <path d="M-80 402 C120 380 240 396 360 386 S560 372 720 388 V520 H-80Z" fill="url(#vg-field)" />
        <g fill="none" stroke="#f2c46b" strokeOpacity="0.22" strokeWidth="1.4" strokeLinecap="round">
          <path d="M-80 426 C160 404 330 424 720 400" />
          <path d="M-80 450 C170 428 340 450 720 424" />
          <path d="M-80 476 C180 454 350 478 720 450" />
          <path d="M-80 504 C190 482 360 506 720 478" />
        </g>
        <path className="trail" d="M286 520 C300 470 252 446 322 414 S368 386 350 350" fill="none" stroke="#ffe3a0" strokeOpacity="0.4" strokeWidth="7" strokeLinecap="round" strokeDasharray="1 14" />
        <g className="vl-flies" fill="#ffe9a8">
          {FIREFLIES.map(([x, y, d], i) => (
            <circle key={i} className="fly" style={{ "--d": `${d}s` }} cx={x} cy={y} r="2.2" />
          ))}
        </g>
      </g>
    </svg>
  );
}
