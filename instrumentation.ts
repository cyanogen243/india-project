/**
 * Runs once, before the server takes its first request.
 *
 * `sharp` loads its native library with dlopen, which no build-time tracer can
 * follow, so a deployment missing it builds and starts perfectly well and then
 * fails quietly: the optimiser hands back originals instead of resized files,
 * and uploads are refused one contributor at a time with a message about an
 * unreadable image. Neither says what is actually wrong.
 *
 * Loading it here turns that into a server that refuses to start, which a
 * deploy can see. The import is the check — it is here for its failure, not
 * for a value, so there is nothing to consume and nothing to tidy away.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    await import("sharp");
  } catch (cause) {
    throw new Error(
      "sharp could not be loaded, so this build cannot process images. Every " +
        "contributed image is re-encoded through it, and that re-encode is what " +
        "strips the camera and location metadata a photo carries — serving " +
        "without it would put contributors at risk, so the server stops here. " +
        "Usually a container missing the native library beside the module: " +
        "check that node_modules/sharp and node_modules/@img both reached the " +
        "runtime image.",
      { cause },
    );
  }
}
