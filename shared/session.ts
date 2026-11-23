export const challengeText = (origin: string, device: string, nonce: string) =>
  ["Reading Box browser sign-in v1", origin, device, nonce].join("\n");
