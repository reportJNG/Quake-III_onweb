const DEFAULT_MAX_WIDTH = 5120;
const DEFAULT_MAX_HEIGHT = 2880;
const DEFAULT_MAX_PIXELS = DEFAULT_MAX_WIDTH * DEFAULT_MAX_HEIGHT;

export function calculateResolution(cssWidth, cssHeight, devicePixelRatio = 1, options = {}) {
  const width = Math.max(0, Math.round(Number(cssWidth) || 0));
  const height = Math.max(0, Math.round(Number(cssHeight) || 0));
  if (!width || !height) return null;

  const dprLimit = Math.max(1, Number(options.dprLimit) || 2);
  const maxWidth = Math.max(1, Number(options.maxWidth) || DEFAULT_MAX_WIDTH);
  const maxHeight = Math.max(1, Number(options.maxHeight) || DEFAULT_MAX_HEIGHT);
  const maxPixels = Math.max(1, Number(options.maxPixels) || DEFAULT_MAX_PIXELS);
  let pixelRatio = Math.min(Math.max(1, Number(devicePixelRatio) || 1), dprLimit);

  pixelRatio = Math.min(
    pixelRatio,
    maxWidth / width,
    maxHeight / height,
    Math.sqrt(maxPixels / (width * height)),
  );
  pixelRatio = Math.max(1 / Math.max(width, height), pixelRatio);

  return Object.freeze({
    cssWidth: width,
    cssHeight: height,
    width: Math.max(1, Math.round(width * pixelRatio)),
    height: Math.max(1, Math.round(height * pixelRatio)),
    pixelRatio,
  });
}

function sameResolution(left, right) {
  return left && right
    && left.cssWidth === right.cssWidth
    && left.cssHeight === right.cssHeight
    && left.width === right.width
    && left.height === right.height
    && left.fullscreen === right.fullscreen;
}

export class ResolutionController {
  constructor(canvas, container, options = {}) {
    this.canvas = canvas;
    this.container = container;
    this.options = options;
    this.window = options.windowTarget || window;
    this.document = options.documentTarget || document;
    this.ResizeObserver = options.ResizeObserver || this.window.ResizeObserver;
    this.requestFrame = options.requestFrame || this.window.requestAnimationFrame.bind(this.window);
    this.cancelFrame = options.cancelFrame || this.window.cancelAnimationFrame.bind(this.window);
    this.onResize = options.onResize || (() => {});
    this.frame = 0;
    this.state = null;
    this.started = false;
    this.observer = null;
    this.schedule = this.schedule.bind(this);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.window.addEventListener('resize', this.schedule, { passive: true });
    this.window.addEventListener('orientationchange', this.schedule, { passive: true });
    this.window.visualViewport?.addEventListener('resize', this.schedule, { passive: true });
    this.document.addEventListener('fullscreenchange', this.schedule);
    if (this.ResizeObserver) {
      this.observer = new this.ResizeObserver(this.schedule);
      this.observer.observe(this.container);
    }
    this.sync();
  }

  schedule() {
    if (!this.started || this.frame) return;
    this.frame = this.requestFrame(() => {
      this.frame = 0;
      this.sync();
    });
  }

  sync() {
    const bounds = this.container.getBoundingClientRect();
    const resolution = calculateResolution(bounds.width, bounds.height, this.window.devicePixelRatio, this.options);
    if (!resolution) return false;
    const next = Object.freeze({ ...resolution, fullscreen: Boolean(this.document.fullscreenElement) });
    const canvasMatches = this.canvas.width === next.width
      && this.canvas.height === next.height
      && this.canvas.style.width === `${next.cssWidth}px`
      && this.canvas.style.height === `${next.cssHeight}px`;
    if (sameResolution(this.state, next) && canvasMatches) return false;

    this.canvas.width = next.width;
    this.canvas.height = next.height;
    this.canvas.style.width = `${next.cssWidth}px`;
    this.canvas.style.height = `${next.cssHeight}px`;
    this.state = next;
    this.onResize(next);
    return true;
  }

  getState() {
    return this.state;
  }

  dispose() {
    if (!this.started) return;
    this.started = false;
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.window.removeEventListener('resize', this.schedule);
    this.window.removeEventListener('orientationchange', this.schedule);
    this.window.visualViewport?.removeEventListener('resize', this.schedule);
    this.document.removeEventListener('fullscreenchange', this.schedule);
  }
}
