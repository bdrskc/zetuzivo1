import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

// Write web/dist/version.json (20 lowercase hex chars) so the backend can
// announce the frontend version over WebSocket, like the upstream app does.
const version = createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 20);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/version.json", JSON.stringify({ version }) + "\n");
console.log("version.json:", version);
