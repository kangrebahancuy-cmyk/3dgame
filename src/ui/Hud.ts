/** DOM overlay: loading indicator, FPS counter, restart button and error panel. */
export class Hud {
  private readonly fps = this.el<HTMLElement>('fps');
  private readonly loading = this.el<HTMLElement>('loading');
  private readonly loadingText = this.el<HTMLElement>('loading-text');
  private readonly loadingBar = this.el<HTMLElement>('loading-bar');
  private readonly error = this.el<HTMLElement>('error');
  private readonly errorMessage = this.el<HTMLElement>('error-message');
  private readonly errorDetail = this.el<HTMLElement>('error-detail');
  private readonly retry = this.el<HTMLButtonElement>('error-retry');
  private readonly dismiss = this.el<HTMLButtonElement>('error-dismiss');
  private readonly restart = this.el<HTMLButtonElement>('restart');
  private lastFps = '';
  private errorShown = false;

  private el<T extends HTMLElement>(id: string): T {
    const e = document.getElementById(id);
    if (!e) throw new Error(`index.html is missing #${id}`);
    return e as T;
  }

  onRestart(cb: () => void): void {
    this.restart.addEventListener('click', () => {
      cb();
      (document.getElementById('game') as HTMLElement | null)?.focus();
    });
  }

  onRetry(cb: () => void): void {
    this.retry.addEventListener('click', () => {
      this.hideError();
      cb();
    });
    this.dismiss.addEventListener('click', () => this.hideError());
  }

  showRestart(visible: boolean): void {
    this.restart.hidden = !visible;
  }

  showLoading(text: string, fraction?: number): void {
    this.loading.classList.remove('done');
    this.loading.hidden = false;
    this.loadingText.textContent = text;
    if (fraction !== undefined) this.loadingBar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  hideLoading(): void {
    this.loadingBar.style.width = '100%';
    this.loading.classList.add('done');
    window.setTimeout(() => {
      if (this.loading.classList.contains('done')) this.loading.hidden = true;
    }, 400);
  }

  setFps(fps: number): void {
    const s = `${Math.round(fps)} FPS`;
    if (s !== this.lastFps) {
      this.lastFps = s;
      this.fps.textContent = s;
    }
  }

  /** Shows a human-readable message plus optional technical detail. Only the first error is shown until dismissed. */
  showError(message: string, detail?: unknown): void {
    if (this.errorShown) return;
    this.errorShown = true;
    this.errorMessage.textContent = message;
    this.errorDetail.textContent = detail === undefined ? '' : detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail);
    this.error.hidden = false;
    this.loading.classList.add('done');
    this.loading.hidden = true;
    console.error('[3DGAME]', message, detail);
  }

  hideError(): void {
    this.errorShown = false;
    this.error.hidden = true;
  }
}
