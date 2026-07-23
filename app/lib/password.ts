import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(pbkdf2);
const ALGORITHM = "sha256";
const ITERATIONS = 600_000;
const KEY_BYTES = 32;
const DUMMY_HASH = `pbkdf2-${ALGORITHM}$${ITERATIONS}$${"00".repeat(16)}$${"00".repeat(KEY_BYTES)}`;

function assertPassword(password: string) {
  if (password.length < 12) {
    throw new Error("Passwords must contain at least 12 characters");
  }
  if (password.length > 128) {
    throw new Error("Passwords must contain no more than 128 characters");
  }
}

export async function hashPassword(password: string) {
  assertPassword(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt, ITERATIONS, KEY_BYTES, ALGORITHM);
  return `pbkdf2-${ALGORITHM}$${ITERATIONS}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encodedHash?: string) {
  const value = encodedHash ?? DUMMY_HASH;
  const [algorithmLabel, iterationText, saltHex, expectedHex] = value.split("$");
  if (
    algorithmLabel !== `pbkdf2-${ALGORITHM}` ||
    !iterationText ||
    !saltHex ||
    !expectedHex
  ) {
    await verifyPassword(password);
    return false;
  }
  const iterations = Number(iterationText);
  if (!Number.isSafeInteger(iterations) || iterations < ITERATIONS) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await derive(password, salt, iterations, expected.length, ALGORITHM);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
