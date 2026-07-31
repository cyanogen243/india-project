import { discardStoredObjects } from "@/app/lib/storage";

/**
 * Raised when a contribution's files could not be removed from storage.
 *
 * The row is the only thing that knows the keys, so it must not be cleared
 * until the objects are confirmed gone. Callers translate this into their own
 * wording — a contributor withdrawing their work and a moderator declining
 * someone else's read different sentences — but obey the same rule.
 */
export class StoredObjectsNotReleased extends Error {
  constructor(readonly keys: string[]) {
    super(`Could not remove stored objects: ${keys.join(", ")}`);
    this.name = "StoredObjectsNotReleased";
  }
}

/**
 * Removes a contribution's stored objects, or throws.
 *
 * Call before the write that makes the keys unreachable — clearing them, or
 * deleting the row. On success the caller may proceed; on failure nothing has
 * been promised and nothing should change.
 */
export async function releaseStoredObjects(keys: unknown[]): Promise<void> {
  const failed = await discardStoredObjects(keys);
  if (failed.length > 0) throw new StoredObjectsNotReleased(failed);
}
