import { discardStoredObjects } from "@/app/lib/storage";

/**
 * Raised when a contribution's files could not be removed from storage.
 *
 * A row and its objects live in two stores with no transaction across them, so
 * every path that ends a submission has the same ordering problem: the row is
 * the only thing that knows the keys, and clearing it first makes a failed
 * delete unrecoverable. Removing the objects and *verifying* it before touching
 * the row is what keeps the two in step, and this is how a caller learns the
 * first half did not happen.
 *
 * Callers translate it into their own copy, because the audience differs — a
 * contributor withdrawing their work and a moderator declining someone else's
 * need to read different sentences — but the rule they are all obeying is the
 * same one, stated here.
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
