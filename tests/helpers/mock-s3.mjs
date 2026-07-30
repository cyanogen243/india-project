import { createHash } from "node:crypto";
import http from "node:http";

/**
 * A minimal S3-compatible object store, in memory, for tests.
 *
 * The suite otherwise runs against the local-disk driver, which means the S3
 * path — the one every deployment actually uses — was never executed by a
 * test. It also cannot fail on demand: `writeFile` either works for both
 * variants or neither, so the case that matters most, a request that stores
 * the print image and then fails on the social one, was untestable. This mock
 * closes both gaps.
 *
 * It implements exactly the three operations the storage driver issues —
 * PutObject, GetObject, DeleteObject — and nothing else. It does not verify
 * signatures. The driver's credentials are exercised
 * against the real bucket by `npm run check:storage`; what is under test here
 * is the route's behaviour when a put, or the work after it, goes wrong.
 */
export async function startMockS3({ failOnKey = null } = {}) {
  /** @type {Map<string, { bytes: Buffer, contentType: string }>} */
  const objects = new Map();
  let failing = failOnKey;
  let failingDeletes = null;

  const server = http.createServer((req, res) => {
    // Path-style addressing: /<bucket>/<key>. The driver sets forcePathStyle.
    const url = new URL(req.url, "http://localhost");
    const [, , ...keyParts] = url.pathname.split("/");
    const key = decodeURIComponent(keyParts.join("/"));

    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (failing && failing(key)) {
          // The shape S3 uses for a refusal, so the SDK raises rather than
          // silently treating it as success.
          res.writeHead(500, { "content-type": "application/xml" });
          res.end(
            `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code>` +
              `<Message>Injected failure for ${key}</Message></Error>`,
          );
          return;
        }
        const bytes = Buffer.concat(chunks);
        objects.set(key, {
          bytes,
          contentType: req.headers["content-type"] ?? "application/octet-stream",
        });
        res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"` });
        res.end();
      });
      return;
    }

    if (req.method === "GET") {
      const object = objects.get(key);
      if (!object) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>`,
        );
        return;
      }
      res.writeHead(200, {
        "content-type": object.contentType,
        "content-length": String(object.bytes.byteLength),
      });
      res.end(object.bytes);
      return;
    }

    if (req.method === "DELETE") {
      if (failingDeletes && failingDeletes(key)) {
        res.writeHead(500, { "content-type": "application/xml" });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code>` +
            `<Message>Injected delete failure for ${key}</Message></Error>`,
        );
        return;
      }
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket: "test-bucket",
    keys: () => [...objects.keys()].sort(),
    get: (key) => objects.get(key),
    /** Start refusing puts whose key matches, to test compensation. */
    failPutsWhere: (predicate) => {
      failing = predicate;
    },
    /** Start refusing deletes, to test that erasure is not reported as done. */
    failDeletesWhere: (predicate) => {
      failingDeletes = predicate;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
