import { gsap } from 'gsap';

/**
 * GSAP motion helpers. Motion is reserved for two things: new tickets entering the list,
 * and a short springy wobble on rare positive moments (reply sent, inbox at zero).
 * Everything is skipped when the user prefers reduced motion.
 */
export function reducedMotion() {
  return typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Slide newly arrived list rows in. Callers pass only rows that weren't shown before. */
export function enterRows(rows: Element[]) {
  if (rows.length === 0 || reducedMotion()) return;
  gsap.from(rows, {
    opacity: 0,
    y: -8,
    duration: 0.18,
    ease: 'power2.out',
    stagger: 0.04,
    clearProps: 'opacity,transform',
  });
}

/** About 300ms springy wobble: a quick pop and a small tilt that settles. */
export function wobble(el: Element | null) {
  if (!el || reducedMotion()) return;
  gsap
    .timeline({ defaults: { overwrite: 'auto' } })
    .fromTo(el, { scale: 0.94, rotation: -2 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' })
    .to(el, { keyframes: { rotation: [-2, 1.5, -0.75, 0] }, duration: 0.3, ease: 'none' }, 0)
    .set(el, { clearProps: 'transform' });
}
