// Station PINs keep a casual passer-by off a tablet; they are not strong
// secrets. Stored hashed so the plain PIN never travels in the synced settings.
// (crypto.subtle is unavailable on plain-http local networks, hence FNV-1a.)
export function hashPin(pin) {
  let h = 0x811c9dc5;
  for (const ch of 'clinic-os:' + pin) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
