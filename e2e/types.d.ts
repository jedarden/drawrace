declare module "pngjs" {
  export class PNG {
    static sync: {
      read(data: Buffer): PNG;
      write(png: PNG): Buffer;
    };
    constructor(options: { width: number; height: number });
    data: Buffer;
    width: number;
    height: number;
  }
}
