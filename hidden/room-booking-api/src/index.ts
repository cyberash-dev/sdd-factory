import { startServer } from "./app/index.js";

const port = Number(process.env.PORT ?? "3000");

startServer(port).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
