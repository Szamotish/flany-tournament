type TrophyIconProps = {
  seed: string;
  className?: string;
};

export default function TrophyIcon({ seed, className }: TrophyIconProps) {
  const gradCup = `trophy-cup-${seed}`;
  const gradStem = `trophy-stem-${seed}`;
  const gradBase = `trophy-base-${seed}`;

  return (
    <svg viewBox="0 0 64 64" className={className ?? "trophy-svg"} aria-hidden>
      <defs>
        <linearGradient id={gradCup} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe7a6" />
          <stop offset="55%" stopColor="#f4bb4f" />
          <stop offset="100%" stopColor="#bb7415" />
        </linearGradient>
        <linearGradient id={gradStem} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8cc6f" />
          <stop offset="100%" stopColor="#b96d0d" />
        </linearGradient>
        <linearGradient id={gradBase} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7f4d11" />
          <stop offset="100%" stopColor="#55320b" />
        </linearGradient>
      </defs>

      <path
        d="M18 14h28v9c0 8-6 14-14 14s-14-6-14-14z"
        fill={`url(#${gradCup})`}
        stroke="#7a4a12"
        strokeWidth="1.5"
      />
      <path
        d="M17 17h-4c-3 0-5 2-5 5 0 6 4 10 10 10h2"
        fill="none"
        stroke="#c98a24"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M47 17h4c3 0 5 2 5 5 0 6-4 10-10 10h-2"
        fill="none"
        stroke="#c98a24"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="29" y="37" width="6" height="9" rx="2" fill={`url(#${gradStem})`} />
      <rect x="24" y="46" width="16" height="4.5" rx="2" fill={`url(#${gradStem})`} />
      <rect x="20" y="51" width="24" height="6.5" rx="3" fill={`url(#${gradBase})`} />
      <ellipse cx="32" cy="18" rx="10" ry="3" fill="rgba(255,255,255,0.28)" />
    </svg>
  );
}
