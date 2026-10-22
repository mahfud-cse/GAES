type FrameSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
type Result = {
  faceCount?: number;
  matched?: boolean;
  score?: number;
  ready?: boolean;
};
export class BrowserFaceClient {
  private worker: Worker;
  private next = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (r: Result) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(progress: (phase: string) => void) {
    this.worker = new Worker("/face-models/worker.mjs", { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data.progress) {
        progress(data.progress);
        return;
      }
      const call = this.pending.get(data.id);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(data.id);
      if (data.error) call.reject(new Error(String(data.error)));
      else call.resolve(data.value);
    };
    this.worker.onerror = () => this.close("BROWSER_ENGINE_FAILED");
  }
  private request(
    action: string,
    frame?: { width: number; height: number; pixels: Uint8ClampedArray },
  ) {
    if (this.closed) return Promise.reject(new Error("BROWSER_ENGINE_FAILED"));
    const id = ++this.next;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("BROWSER_ENGINE_FAILED"));
        },
        action === "initialize" ? 300000 : 30000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage(
        { id, action, frame },
        frame ? [frame.pixels.buffer] : [],
      );
    });
  }
  private frame(source: FrameSource) {
    const w =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source instanceof HTMLImageElement
          ? source.naturalWidth
          : source.width;
    const h =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source instanceof HTMLImageElement
          ? source.naturalHeight
          : source.height;
    if (w < 80 || h < 80 || w * h > 12000000) throw new Error("INVALID_PHOTO");
    const scale = Math.min(1, 960 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("BROWSER_ENGINE_FAILED");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
    };
  }
  initialize() {
    return this.request("initialize");
  }
  async reference(data: string) {
    if (!data.startsWith("data:image/") || data.length > 1500000)
      throw new Error("INVALID_PHOTO");
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("INVALID_PHOTO"));
      image.src = data;
    });
    return this.request("reference", this.frame(image));
  }
  compare(source: FrameSource) {
    return this.request("compare", this.frame(source));
  }
  detect(source: FrameSource) {
    return this.request("detect", this.frame(source));
  }
  close(code = "BROWSER_DEMO_CLOSED") {
    this.closed = true;
    this.worker.terminate();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(code));
    }
    this.pending.clear();
  }
}
