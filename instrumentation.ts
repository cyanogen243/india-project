/**
 * Runs once, before the server takes its first request.
 *
 * sharp reaches libvips through dlopen, which build-time tracing cannot
 * follow — so a build missing it starts fine and then degrades quietly:
 * uploads refused one contributor at a time, originals served unresized. That
 * re-encode is what strips a photo's location metadata, so not starting is the
 * safer failure. The import is the check; there is nothing to consume.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    await import("sharp");
  } catch (cause) {
    throw new Error(
      "sharp is unavailable, so uploads would keep the metadata re-encoding " +
        "removes. Check node_modules/sharp and node_modules/@img reached the " +
        "runtime image.",
      { cause },
    );
  }
}
