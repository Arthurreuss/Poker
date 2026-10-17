/**
 * Lottie-Player (WP-040, D-034): `lottie-web` in der „light“-Variante (nur SVG-Renderer, ohne Expressions → kein
 * `eval`, mit der CSP vereinbar). Erst beim ersten Abspielen geladen. Eigenes Modul, damit Tests es ersetzen können.
 */
export interface LottiePlayer {
  destroy(): void;
  addEventListener(name: 'complete', cb: () => void): void;
}

export interface LottieLoadOptions {
  readonly container: Element;
  readonly animationData: unknown;
}

export async function loadLottie(): Promise<(options: LottieLoadOptions) => LottiePlayer> {
  const { default: lottie } = await import('lottie-web/build/player/lottie_light');
  return ({ container, animationData }) =>
    lottie.loadAnimation({
      container,
      animationData,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    });
}
