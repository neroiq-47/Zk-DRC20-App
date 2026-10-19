export const secp256k1Vectors = {
  privOne: Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 1 : 0)),
};
