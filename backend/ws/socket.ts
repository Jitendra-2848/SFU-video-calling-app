import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { config } from "../mediasoup/config";
import { getWorker } from "../mediasoup/worker";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let router: any;
const peers = new Map<string, any>();

export const initMediasoup = async () => {
  try {
    const worker = getWorker();
    router = await worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs,
    });
    console.log("[MEDIASOUP] SFU Router initialized successfully");
  } catch (err: any) {
    console.error("[MEDIASOUP] Failed to initialize router:", err.message);
  }
};

io.on("connection", (socket) => {
  peers.set(socket.id, {
    producers: new Map(),
    consumers: new Map(),
    room: null,
    name: "Anonymous",
    Email: "",
  });

  // Handle room join
  socket.on("join", (payload: any) => {
    const data = payload?.user || payload || {};
    const Room = String(data.Room || data.room || "1");
    const Email = data.Email || data.email || "";
    const name = data.name || `User-${socket.id.slice(0, 4)}`;

    const peer = peers.get(socket.id);
    if (!peer) return;

    peer.room = Room;
    peer.Email = Email;
    peer.name = name;

    socket.join(Room);
    console.log(`[JOIN] Peer ${name} (${socket.id}) joined Room ${Room}`);

    if (router) {
      socket.emit("routerCapabilities", router.rtpCapabilities);
    } else {
      socket.emit("error", { message: "SFU Media Router not ready yet" });
    }

    // Notify other peers in the room
    socket.to(Room).emit("peerJoined", { peerId: socket.id, name });
  });

  // Get active peers in room
  socket.on("getRoomPeers", (cb) => {
    if (typeof cb !== "function") return;
    const peer = peers.get(socket.id);
    if (!peer || !peer.room) return cb([]);

    const roomPeers: any[] = [];
    peers.forEach((p, id) => {
      if (id !== socket.id && p.room === peer.room) {
        roomPeers.push({
          peerId: id,
          name: p.name,
        });
      }
    });
    cb(roomPeers);
  });

  // Create WebRtcTransport
  socket.on("createTransport", async ({ type }, cb) => {
    if (typeof cb !== "function") return;
    if (!router) return cb({ error: "SFU Router not initialized" });

    try {
      const transport = await router.createWebRtcTransport({
        listenIps: config.mediasoup.webRtcTransport.listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate,
      });

      const peer = peers.get(socket.id);
      if (peer) {
        peer[type + "Transport"] = transport;
      }

      transport.on("dtlsstatechange", (dtlsState: string) => {
        if (dtlsState === "closed" || dtlsState === "failed") {
          console.warn(`[TRANSPORT DTLS] Peer ${socket.id} ${type} transport DTLS state: ${dtlsState}`);
          transport.close();
        }
      });

      cb({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err: any) {
      console.error("[TRANSPORT ERROR]", err.message);
      cb({ error: err.message || "Failed to create WebRTC transport" });
    }
  });

  // Connect WebRtcTransport
  socket.on("connectTransport", async ({ type, dtlsParameters }, cb) => {
    const peer = peers.get(socket.id);
    const transport = peer ? peer[type + "Transport"] : null;
    if (transport) {
      try {
        await transport.connect({ dtlsParameters });
        if (typeof cb === "function") cb({ connected: true });
      } catch (err: any) {
        console.error("[CONNECT TRANSPORT ERROR]", err.message);
        if (typeof cb === "function") cb({ error: err.message });
      }
    } else {
      if (typeof cb === "function") cb({ error: "Transport not found" });
    }
  });

  // Produce media track
  socket.on("produce", async ({ kind, rtpParameters }, cb) => {
    if (typeof cb !== "function") return;
    const peer = peers.get(socket.id);
    if (!peer || !peer.sendTransport) {
      return cb({ error: "Send transport not found" });
    }

    try {
      const producer = await peer.sendTransport.produce({ kind, rtpParameters });
      peer.producers.set(producer.id, producer);

      // Store metadata
      producer.appData = { peerId: socket.id, kind, name: peer.name };

      console.log(`[PRODUCE] Peer ${peer.name} (${socket.id}) produced ${kind} track (${producer.id})`);

      // Notify other peers in the room
      socket.to(peer.room).emit("newProducer", {
        producerId: producer.id,
        peerId: socket.id,
        name: peer.name,
        kind,
      });

      producer.on("transportclose", () => {
        console.log(`[PRODUCER CLOSE] Producer ${producer.id} transport closed`);
        peer.producers.delete(producer.id);
        producer.close();
      });

      cb({ id: producer.id });
    } catch (err: any) {
      console.error("[PRODUCE ERROR]", err.message);
      cb({ error: err.message });
    }
  });

  // Close producer (e.g. mute video or audio)
  socket.on("closeProducer", ({ producerId }) => {
    const peer = peers.get(socket.id);
    if (!peer) return;

    const producer = peer.producers.get(producerId);
    if (producer) {
      console.log(`[CLOSE PRODUCER] Peer ${peer.name} (${socket.id}) closed producer ${producerId}`);
      producer.close();
      peer.producers.delete(producerId);
      io.to(peer.room).emit("producerClosed", { producerId, peerId: socket.id });
    }
  });

  // Get active producers in the room
  socket.on("getProducers", (cb) => {
    if (typeof cb !== "function") return;
    const peer = peers.get(socket.id);
    if (!peer || !peer.room) return cb([]);

    const result: any[] = [];
    peers.forEach((p, id) => {
      if (id !== socket.id && p.room === peer.room) {
        p.producers.forEach((prod: any, producerId: string) => {
          if (!prod.closed) {
            result.push({
              producerId,
              peerId: id,
              name: p.name,
              kind: prod.kind,
            });
          }
        });
      }
    });
    cb(result);
  });

  // Consume media track
  socket.on("consume", async ({ producerId, rtpCapabilities }, cb) => {
    if (typeof cb !== "function") return;
    if (!router) return cb({ error: "SFU Router not initialized" });

    const peer = peers.get(socket.id);
    if (!peer || !peer.recvTransport) {
      return cb({ error: "Recv transport not found" });
    }

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return cb({ error: "Router cannot consume this producer" });
    }

    try {
      const consumer = await peer.recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true, // Started paused, client calls resumeConsumer
      });

      peer.consumers.set(consumer.id, consumer);

      // Identify producer owner peerId
      let producerPeerId = "";
      peers.forEach((p, id) => {
        if (p.producers.has(producerId)) {
          producerPeerId = id;
        }
      });

      consumer.on("transportclose", () => {
        peer.consumers.delete(consumer.id);
      });

      consumer.on("producerclose", () => {
        peer.consumers.delete(consumer.id);
        socket.emit("producerClosed", { producerId, consumerId: consumer.id, peerId: producerPeerId });
      });

      cb({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err: any) {
      console.error("[CONSUME ERROR]", err.message);
      cb({ error: err.message });
    }
  });

  // Resume paused consumer
  socket.on("resumeConsumer", async ({ consumerId }, cb) => {
    const peer = peers.get(socket.id);
    const consumer = peer ? peer.consumers.get(consumerId) : null;
    if (consumer) {
      try {
        await consumer.resume();
        if (typeof cb === "function") cb({ resumed: true });
      } catch (err: any) {
        if (typeof cb === "function") cb({ error: err.message });
      }
    } else {
      if (typeof cb === "function") cb({ error: "Consumer not found" });
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    const peer = peers.get(socket.id);
    if (peer) {
      peer.producers.forEach((p: any) => p.close());
      peer.consumers.forEach((c: any) => c.close());
      peer.sendTransport?.close();
      peer.recvTransport?.close();

      if (peer.room) {
        io.to(peer.room).emit("peerLeft", { peerId: socket.id, name: peer.name });
      }
      console.log(`[DISCONNECT] Peer ${peer.name} (${socket.id}) disconnected`);
    }
    peers.delete(socket.id);
  });
});

export { app, server };