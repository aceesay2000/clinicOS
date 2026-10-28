// Personal PINs keep the wrong person off a station; with 4 digits they are
// not strong secrets. The real gate is the clinic code + device token, and
// the admin can remove a lost device. Each PIN is salted with the member's
// id, so the same PIN gives different hashes for different people, and the
// plain PIN never travels or is stored. Shared with the server (server/api.js).
export function hashPin(pin, salt = '') {
  let h = 0x811c9dc5;
  for (const ch of `clinic-os:${salt}:${pin}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
