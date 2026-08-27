/**
 * Starts a real host process against a fresh data directory and returns its URL.
 *
 * The host is the packaged binary when one has been built, otherwise host.py.
 * Both are the same program; testing whichever is present means the CI job that
 * builds the executable exercises the executable.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LEDGER = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGED = join(LEDGER, "build", "dist",
  process.platform === "win32" ? "InventoryLedger.exe" : "InventoryLedger");

export interface RunningHost {
  url: string;
  dataDir: string;
  dir: string;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
}

async function waitForHost(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/meta`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`host did not come up at ${url}`);
}

/**
 * Copy the program into `dir` so it runs isolated, exactly as a user unzips it.
 *
 * This matters: the host writes config.ini and data/ NEXT TO ITSELF, not into
 * the working directory, because that is what makes an unzipped folder
 * self-contained and movable. Pointing several test runs at one installed copy
 * would have them all share a ledger -- which is correct behaviour for the
 * program and useless for a test.
 */
function installProgram(dir: string): { command: string; args: string[] } {
  if (existsSync(PACKAGED)) {
    const target = join(dir, process.platform === "win32" ? "InventoryLedger.exe" : "InventoryLedger");
    cpSync(PACKAGED, target);
    return { command: target, args: ["--no-browser"] };
  }
  // Source fallback: host.py plus the built bundle it serves from ../dist.
  cpSync(join(LEDGER, "host", "host.py"), join(dir, "host.py"));
  cpSync(join(LEDGER, "dist"), join(dir, "dist"), { recursive: true });
  return { command: "python3", args: [join(dir, "host.py"), "--no-browser"] };
}

export async function startHost(existingDir?: string): Promise<RunningHost> {
  const dir = existingDir ?? mkdtempSync(join(tmpdir(), "ledger-e2e-"));
  const program = installProgram(dir);
  let proc: ChildProcess | null = null;
  let url = "";

  const launch = async () => {
    proc = spawn(program.command, program.args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });

    const port = await new Promise<number>((resolveP, rejectP) => {
      const timer = setTimeout(() => rejectP(new Error("host printed no URL")), 20_000);
      proc!.stdout!.on("data", (chunk: Buffer) => {
        const m = /localhost:(\d+)/.exec(chunk.toString());
        if (m) { clearTimeout(timer); resolveP(Number(m[1])); }
      });
      proc!.on("exit", (code) => { clearTimeout(timer); rejectP(new Error(`host exited ${code}`)); });
    });

    url = `http://127.0.0.1:${port}`;
    await waitForHost(url);
  };

  const stop = async () => {
    if (!proc) return;
    const p = proc;
    proc = null;
    await new Promise<void>((r) => { p.once("exit", () => r()); p.kill(); setTimeout(r, 3000); });
  };

  await launch();

  return {
    get url() { return url; },
    dataDir: join(dir, "data"),
    dir,
    stop,
    restart: async () => { await stop(); await launch(); },
  };
}

export function cleanup(host: RunningHost): void {
  rmSync(host.dir, { recursive: true, force: true });
}
