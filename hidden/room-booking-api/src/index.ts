import { startServer } from "./server/index.js";

const parsed = Number(process.env.PORT);
const port = Number.isInteger(parsed) && parsed >= 0 ? parsed : 3000;

void startServer(port);
