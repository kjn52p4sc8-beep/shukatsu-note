declare module 'http_ece' {
  import type { ECDH } from 'node:crypto';
  interface DecryptParams {
    version: 'aes128gcm';
    privateKey: ECDH;
    authSecret: Buffer;
  }
  const ece: { decrypt(body: Buffer, params: DecryptParams): Buffer };
  export default ece;
}
