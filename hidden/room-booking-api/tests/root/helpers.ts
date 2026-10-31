import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { vi } from "vitest";

export interface Reply {
  status: number;
  raw: string;
  json: any;
  contentType: string | undefined;
}

export interface Booted {
  port: number;
  close: () => Promise<void>;
}

export async function boot(): Promise<Booted> {
  vi.resetModules();
  const mod = await import("../../src/index.js");
  const server = http.createServer(mod.createHandler());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function send(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body !== undefined) h["Content-Length"] = String(Buffer.byteLength(body));
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: h, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json: any = undefined;
        try {
          json = raw === "" ? undefined : JSON.parse(raw);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, raw, json, contentType: res.headers["content-type"] });
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

export function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), env: env ?? process.env });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("close", (code) => resolve({ code, out }));
  });
}

export async function startBuilt(
  env: NodeJS.ProcessEnv,
  port: number,
): Promise<{ answered: Reply | undefined; stop: () => void }> {
  const child = spawn("npm", ["start"], { cwd: process.cwd(), env, detached: true, stdio: "ignore" });
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  };
  let exited = false;
  child.on("exit", () => (exited = true));
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !exited) {
    try {
      const r = await send(port, "GET", "/rooms");
      return { answered: r, stop };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return { answered: undefined, stop };
}
