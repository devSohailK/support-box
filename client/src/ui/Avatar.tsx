// Muted warm neutrals (--md-avatar-1..8): tell people apart without borrowing the status colours.
const HUE_COUNT = 8;

function initials(name: string) {
  const parts = name.replace(/[<>@].*$/, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

function hueFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--md-avatar-${(h % HUE_COUNT) + 1})`;
}

export function Avatar({ name, seed, size = 36 }: { name: string; seed?: string; size?: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.38, background: hueFor(seed ?? name) }}
    >
      {initials(name)}
    </span>
  );
}
