declare module "opentype.js" {
  const opentype: {
    parse(buffer: ArrayBuffer | Buffer, opt?: any): any;
    load(url: string, callback?: (err: any, font?: any) => void): void;
  };
  export default opentype;
}
