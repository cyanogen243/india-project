import { mkdir } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { createInitialSuperAdmin } from "../app/lib/auth";

async function readHidden(label: string) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error(
      "A secure password prompt requires a terminal. Set ADMIN_BOOTSTRAP_PASSWORD for non-interactive use.",
    );
  }
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const onData = (buffer: Buffer) => {
      const key = buffer.toString("utf8");
      if (key === "\u0003") {
        cleanup();
        reject(new Error("Cancelled"));
      } else if (key === "\r" || key === "\n") {
        stdout.write("\n");
        cleanup();
        resolve(value);
      } else if (key === "\u007f" || key === "\b") {
        if (value.length) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
      } else if (/^[\P{Cc}]+$/u.test(key)) {
        value += key;
        stdout.write("•");
      }
    };
    function cleanup() {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    stdin.on("data", onData);
  });
}

await mkdir("data", { recursive: true });
let email = process.env.ADMIN_BOOTSTRAP_EMAIL;
let displayName = process.env.ADMIN_BOOTSTRAP_NAME;

if (!email || !displayName) {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    email ??= await prompt.question("Super-admin email: ");
    displayName ??= await prompt.question("Display name: ");
  } finally {
    prompt.close();
  }
}

const password =
  process.env.ADMIN_BOOTSTRAP_PASSWORD ??
  (await readHidden("Password (12-128 characters): "));
const confirmation =
  process.env.ADMIN_BOOTSTRAP_PASSWORD ??
  (await readHidden("Confirm password: "));

if (password !== confirmation) throw new Error("Passwords do not match");
await createInitialSuperAdmin(email, displayName, password);
console.log(`Super-admin created for ${email.trim().toLowerCase()}.`);
