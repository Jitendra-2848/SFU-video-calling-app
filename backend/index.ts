import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import os from "os";
import { createWorkers } from "./mediasoup/worker";
import { server, app, initMediasoup } from "./ws/socket";

app.use(cors({ origin: "*", credentials: true }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`[SFU] Server running on port ${PORT}`);

  const workers = await createWorkers();
  console.log(`[SFU] Spawned ${workers.length} Mediasoup worker(s) on ${os.cpus().length} CPU core(s)`);

  await initMediasoup();
});

// Periodic server stats (CPU + Memory)
setInterval(() => {
  const mem = process.memoryUsage();
  const cpu = os.loadavg();
  console.log("=== SERVER METRICS ===");
  console.log(`Memory: RSS ${(mem.rss / 1024 / 1024).toFixed(2)} MB | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`CPU Load: ${cpu.map((c) => c.toFixed(2)).join(", ")}`);
}, 15000);
