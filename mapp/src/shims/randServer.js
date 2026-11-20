export const RAND_SERVER_MAX_BYTES = 1024;
export const RAND_SERVER_DEFAULT_BYTES = 32;

export async function fetchServerRandom() {
  throw new Error("微应用版不提供联网随机源");
}

export const __shim = true;
