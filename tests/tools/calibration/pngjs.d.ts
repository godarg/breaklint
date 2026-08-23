declare module "pngjs" {
  interface DecodedPng {
    data: Buffer;
    height: number;
    width: number;
  }

  export const PNG: {
    sync: {
      read(value: Buffer): DecodedPng;
    };
  };
}
