import { gsap } from 'gsap';

/**
 * GSAP motion helpers. Rules (docs/DESIGN.md):
 * - Frequent motion (tabs, counts, rows) is 120 to 180ms, plain easing, transform and opacity only.
 * - Bounce is reserved for two moments: a sent row leaving the list, and inbox zero.
 * - Nothing replays on the 10s background refresh.
 * - Under prefers-reduced-motion every helper jumps straight to the final state.
 */
export function reducedMotion() {
  return typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FAST = 0.16;

/** Slide newly arrived list rows in. Callers pass only rows that weren't shown before. */
export function enterRows(rows: Element[]) {
  if (rows.length === 0 || reducedMotion()) return;
  gsap.from(rows, { opacity: 0, y: -6, duration: FAST, ease: 'power2.out', stagger: 0.03, clearProps: 'opacity,transform' });
}

/** About 300ms springy wobble: a quick pop and a small tilt that settles. */
export function wobble(el: Element | null) {
  if (!el || reducedMotion()) return;
  gsap
    .timeline({ defaults: { overwrite: 'auto' } })
    .fromTo(el, { scale: 0.94 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' })
    .to(el, { keyframes: { rotation: [-2, 1.5, -0.75, 0] }, duration: 0.3, ease: 'none' }, 0)
    .set(el, { clearProps: 'transform' });
}

/** A sent or closed row says goodbye: accent flash, one wobble, then it folds away. */
export function leaveRow(row: HTMLElement, done: () => void) {
  if (reducedMotion()) return done();
  row.classList.add('is-leaving');
  gsap
    .timeline({ onComplete: done })
    .to(row, { keyframes: { rotation: [0, -0.6, 0.4, 0] }, scale: 0.985, duration: 0.3, ease: 'back.out(3)' })
    .to(row, { opacity: 0, x: 24, duration: FAST, ease: 'power2.in' })
    .to(row, { height: 0, paddingTop: 0, paddingBottom: 0, duration: FAST, ease: 'power2.inOut' });
}

/** A sent row that stays in the view (e.g. "Any status") just flashes and wobbles in place. */
export function flashRow(row: HTMLElement | null) {
  if (!row) return;
  row.classList.add('is-flash');
  setTimeout(() => row.classList.remove('is-flash'), 900);
  wobble(row);
}

/** Roll a count to its new value. Upward change rolls up, downward rolls down. */
export function tickCount(el: HTMLElement, from: number, to: number) {
  if (from === to) return;
  if (reducedMotion()) {
    el.textContent = String(to);
    return;
  }
  const dir = to > from ? 1 : -1;
  gsap.killTweensOf(el);
  gsap
    .timeline()
    .to(el, { y: -4 * dir, opacity: 0, duration: 0.07, ease: 'power1.in' })
    .call(() => {
      el.textContent = String(to);
    })
    .fromTo(el, { y: 4 * dir }, { y: 0, opacity: 1, duration: 0.11, ease: 'power2.out', clearProps: 'transform,opacity' });
}

/** Move the tab indicator under the active tab. Animates only when `animate` is true. */
export function slideIndicator(indicator: HTMLElement, target: HTMLElement, animate: boolean) {
  const vars = { x: target.offsetLeft, width: target.offsetWidth, opacity: 1 };
  if (!animate || reducedMotion()) gsap.set(indicator, vars);
  else gsap.to(indicator, { ...vars, duration: FAST, ease: 'power2.out', overwrite: 'auto' });
}

/** Login: one entrance sequence, about 500ms, played once per visit. */
export function loginIntro(root: HTMLElement) {
  if (reducedMotion()) return;
  const q = gsap.utils.selector(root);
  gsap
    .timeline({ defaults: { ease: 'power2.out', clearProps: 'opacity,transform' } })
    .from(q('.login-story .brand'), { opacity: 0, y: -6, duration: 0.18 })
    .from(q('.story-line'), { opacity: 0, y: 6, duration: 0.18 }, '-=0.08')
    .from(q('.bubble'), { opacity: 0, y: 8, duration: 0.18, stagger: 0.08 }, '-=0.08')
    .from(q('.login-form > *'), { opacity: 0, y: 6, duration: 0.16, stagger: 0.03 }, 0.05);
}

/** Wrong password: a small, plain shake. Errors never wobble. */
export function shake(el: Element | null) {
  if (!el || reducedMotion()) return;
  gsap.fromTo(el, { x: 0 }, { keyframes: { x: [-6, 6, -4, 4, 0] }, duration: 0.24, ease: 'none', clearProps: 'transform' });
}
