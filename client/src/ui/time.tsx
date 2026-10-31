const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relative(iso: string, now = Date.now()) {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "3 hours ago", with the exact time on hover and for screen readers via <time>. */
export function RelativeTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatDate(iso)}>
      {relative(iso)}
    </time>
  );
}
