// Station PINs keep a casual passer-by off a phone; they are not strong
// secrets. Stored hashed so the plain PIN never travels in the synced settings.
// (FNV-1a keeps this independent of crypto.subtle, which plain-http pages lack.)
export function hashPin(pin) {
  let h = 0x811c9dc5;
  for (const ch of 'clinic-os:' + pin) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
