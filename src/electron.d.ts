declare module "electron" {
  export interface NativeImage {
    isEmpty(): boolean;
    getSize(): { width: number; height: number };
    resize(options: { width: number; quality: "good" | "better" | "best" }): NativeImage;
    toJPEG(quality: number): Buffer;
  }

  export const nativeImage: {
    createFromBuffer(buffer: Buffer): NativeImage;
  };

  export const clipboard: {
    write(data: { html?: string; text?: string }): void;
  };
}
