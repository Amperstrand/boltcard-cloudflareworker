declare module "aes-js" {
  namespace ModeOfOperation {
    class ecb {
      constructor(key: Uint8Array);
      encrypt(data: Uint8Array): Uint8Array;
      decrypt(data: Uint8Array): Uint8Array;
    }
  }

  const AES: {
    ModeOfOperation: {
      ecb: typeof ModeOfOperation.ecb;
    };
  };

  export default AES;
  export { AES };
}
