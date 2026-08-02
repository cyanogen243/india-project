/**
 * Runs once, before the server takes its first request.
 *
 * `sharp` loads its native library with dlopen, which no build-time tracer can
 * follow, so an image that is missing it builds and starts perfectly well and
 * then fails quietly: the optimiser hands back originals instead of resized
 * files, and uploads are refused one contributor at a time with a message
 * about an unreadable image. Neither says what is actually wrong.
 *
 * Loading it here turns that into a server that refuses to start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("sharp");
}
