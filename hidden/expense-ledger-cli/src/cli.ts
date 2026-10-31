import { main } from "./index.js";

const write = (stream: NodeJS.WriteStream) => (line: string) => void stream.write(line + "\n");
const io = { stdout: write(process.stdout), stderr: write(process.stderr), env: process.env, now: () => new Date() };
process.exitCode = await main(process.argv.slice(2), io);
