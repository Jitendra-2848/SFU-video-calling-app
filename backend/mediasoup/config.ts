import { RtpCodecCapability, TransportListenIp, WorkerLogTag } from "mediasoup/node/lib/types";
import os from "os";

// Detect non-internal local IPv4 address as default announced IP if not provided
function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaces = interfaces[name];
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

const announcedIp = process.env.ANNOUNCED_IP || getLocalIp();

export const config = {
  listenIp: "0.0.0.0",
  listenPort: 3000,
  announcedIp,

  mediasoup: {
    numWorkers: Math.max(1, os.cpus().length),
    worker: {
      rtcMinPort: 3100,
      rtcMaxPort: 3200 + (os.cpus().length * 100),
      logLevel: 'warn',
      logTags: [
        "info", "ice", "dtls", "rtp", "srtp", "rtcp", "rtx", "bwe",
        "score", "simulcast", "svc", "sctp", "message"
      ] as WorkerLogTag[],
    },
    router: { 
      mediaCodecs: [
        // Video - VP8 (Universal WebRTC support)
        {
          kind: "video" as const,
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 300,
          },
        },
        // Video - H.264 Constrained Baseline
        {
          kind: "video" as const,
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "42e01f",
            "level-asymmetry-allowed": 1,
            "x-google-start-bitrate": 300,
          },
        },
        // Audio - Opus
        {
          kind: "audio" as const,
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
          parameters: {
            minptime: 10,
            useinbandfec: 1,
          },
        },
      ] as unknown as RtpCodecCapability[],
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: announcedIp,
        } as TransportListenIp,
      ],
      initialAvailableOutgoingBitrate: 600000,
      minimumAvailableOutgoingBitrate: 100000,
    },
  },
};
