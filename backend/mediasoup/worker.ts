import * as mediasoup from "mediasoup";
import type { Worker } from "mediasoup/node/lib/types";
import { config } from "./config";
import os from "os";

export const workers: Worker[] = [];
let nextWorkerIdx = 0;

const cpuCount = Math.min(Math.max(1, os.cpus().length), 8);

export const createWorkers = async () => {
  if (workers.length > 0) return workers;

  for (let i = 0; i < cpuCount; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel as any,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });

    worker.on("died", () => {
      console.error(`Mediasoup Worker ${i} died, exiting...`);
      process.exit(1);
    });

    workers.push(worker);
  }
  return workers;
};

export const getWorker = () => {
  if (workers.length === 0) {
    throw new Error("No Mediasoup workers initialized yet");
  }
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
};