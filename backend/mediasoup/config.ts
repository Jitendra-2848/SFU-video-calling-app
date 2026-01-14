// import mediasoup from "mediasoup"

// WorkerImpl

import { RtpCodecCapability, TransportListenIp, WorkerLogTag } from "mediasoup/node/lib/types";
import os from "os";
import { channel } from "process";

export const config = {
  listenIp: "0.0.0.0",
  listenPort: 3001,

  mediasoup: {
    numWorkers: Object.keys(os.cpus()).length,
    worker: {
      rtcMinPort: 3100,
      rtcMaxPort: 3200,
      logLevel: 'debug',
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp", 
        "srtp",
        "rtcp",
        "rtx",
        "rbe",
        "bwe",
        "score",
        "simulcast",
        "svc",
        "sctp",
        "message",
      ] as WorkerLogTag[],
      router: {
        mediaCodecs: [
          {
            kind: "video",
            mimeType: "video/VP8",
            clockRate: 90000,
            parameters: {
              "x-google-start-bitrate": 1000,
            },
          },
          {
            kind: "audio",
            mimeType: "audio/opus",
            clockRate: 48000,
            channels: 2,
          },
        ] as RtpCodecCapability[],
      },
      webRtcTransport: {
        listenIps: [
          {
            ip: "0.0.0.0",
            announcedIp: "127.0.0.1", // replace by public ip 
          },
        ] as TransportListenIp[],
      },
    },
  },
};
