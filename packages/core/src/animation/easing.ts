export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'] as const;
export type Easing = (typeof EASINGS)[number];

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

export function applyEasing(easing: Easing, t: number): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t * t;
    case 'easeOut':
      return 1 - (1 - t) ** 3;
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case 'hold':
      return 0;
  }
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number): number =>
  1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2;
export const easeInBack = (t: number): number => BACK_C3 * t * t * t - BACK_C1 * t * t;
