/**
 * Aadhaar number validation — offline format + Verhoeff checksum only.
 *
 * This does NOT contact UIDAI or verify that a number was actually issued; it
 * only rejects typos and impossible numbers before we hash and store them.
 * The last digit of a valid Aadhaar is a Verhoeff check digit over the first 11.
 */

// Verhoeff multiplication table (d).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Verhoeff permutation table (p).
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True if `digits` (a string of digits) passes the Verhoeff checksum. */
function verhoeffValid(digits) {
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

/** Strip spaces / hyphens. Returns digits only (may still be invalid). */
function normaliseAadhaar(raw) {
  return String(raw || '').replace(/[\s-]/g, '');
}

/**
 * Full validation: exactly 12 digits, first digit 2-9 (Aadhaar never begins with
 * 0 or 1), and a passing Verhoeff check digit.
 */
function isValidAadhaar(raw) {
  const n = normaliseAadhaar(raw);
  if (!/^[2-9]\d{11}$/.test(n)) return false;
  return verhoeffValid(n);
}

/** Last 4 digits of the normalised number (for masked display). */
function last4(raw) {
  return normaliseAadhaar(raw).slice(-4);
}

module.exports = { normaliseAadhaar, isValidAadhaar, last4, verhoeffValid };
