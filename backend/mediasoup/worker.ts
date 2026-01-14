import * as mediasoup from "mediasoup";
import type { Worker, Router } from "mediasoup/node/lib/types";
import { config } from "./config";

export const worker: Array<{ worker: Worker; Router: Router }> = [];

let nextMediasoupWorkerIdx = 0;

const createWorker = async () => {
  const worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel as any,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  });

  worker.on("died", () => {
    console.error("Mediasoup worker died, exiting...");
    process.exit(1);
  });

  const mediaCodecs = config.mediasoup.worker.router.mediaCodecs;
  const mediasoupRouter = await worker.createRouter({ mediaCodecs });
  return mediasoupRouter;
};

export {createWorker};