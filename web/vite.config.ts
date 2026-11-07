import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// In dev, serve api/fund.ts the way Vercel will in production.
function landOffice(): Plugin {
  return {
    name: "turf-land-office",
    configureServer(server) {
      const keyFile = resolve(__dirname, "../keys/treasury.json");
      if (!process.env.TREASURY_SECRET && existsSync(keyFile)) {
        process.env.TREASURY_SECRET = readFileSync(keyFile, "utf8");
      }
      if (!process.env.RPC_URL && process.env.VITE_RPC_URL) process.env.RPC_URL = process.env.VITE_RPC_URL;
      server.middlewares.use("/api/fund", async (req, res) => {
        const mod = (await server.ssrLoadModule("/api/fund.ts")) as {
          GET: () => Promise<Response>;
          POST: (r: Request) => Promise<Response>;
        };
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const request = new Request("http://localhost/api/fund", {
          method: req.method,
          headers: { "content-type": "application/json", "x-forwarded-for": req.socket.remoteAddress ?? "local" },
          body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        });
        const out = req.method === "POST" ? await mod.POST(request) : await mod.GET();
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await out.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [landOffice()],
  define: { "process.env.NODE_DEBUG": "false" },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
