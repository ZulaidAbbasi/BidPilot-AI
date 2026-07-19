/**
 * Motion helpers.
 * We use CSS classes only — framer-motion is not a project dependency.
 * The global `prefers-reduced-motion` block in `src/styles.css` neutralizes
 * every keyframe and transform below, so these classes are safe to apply
 * without additional guards.
 */

export const motion = {
  fadeIn: "animate-[fadeIn_240ms_ease-out_both]",
  fadeUp: "animate-[fadeUp_260ms_ease-out_both]",
  scaleIn: "animate-[scaleIn_180ms_ease-out_both]",
  pulse: "animate-[softPulse_1.6s_ease-in-out_infinite]",
  flash: "animate-[flashOnce_600ms_ease-out_both]",
} as const;
