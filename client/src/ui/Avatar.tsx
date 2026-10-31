// Soft, distinguishable hues; white text passes 4.5:1 on all of them.
const HUES = ['#0f766e', '#6d4fd8', '#b45309', '#1d4ed8', '#be185d', '#047857', '#7c3aed', '#c2410c'];

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
  return HUES[h % HUES.length]!;
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
