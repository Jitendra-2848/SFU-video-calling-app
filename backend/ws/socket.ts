import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createWorker } from "mediasoup";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let router: any;
const peers = new Map<string, any>();

(async () => {
  const worker = await createWorker();
  router = await worker.createRouter({
    mediaCodecs: [
      { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
      { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
    ],
  });
  console.log("Server ready");
})();

io.on("connection", (socket) => { 
  peers.set(socket.id, { producers: new Map(), consumers: new Map() });

  socket.on("join", ({ Room,Email,name }) => {
    const peer = peers.get(socket.id)
    peer.room = Room;
    peer.Email = Email;
    peer.name = name;
    socket.join(Room);
    socket.emit("routerCapabilities", router.rtpCapabilities);
  });

  socket.on("createTransport", async ({ type }, cb) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }],
      enableUdp: true,
      enableTcp: true,
    });
    peers.get(socket.id)[type + "Transport"] = transport;
    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  });

  socket.on("connectTransport", async ({ type, dtlsParameters }, cb) => {
    await peers.get(socket.id)[type + "Transport"].connect({ dtlsParameters });
    cb();
  });

  socket.on("produce", async ({ kind, rtpParameters }, cb) => {
    const peer = peers.get(socket.id);
    const producer = await peer.sendTransport.produce({ kind, rtpParameters });
    peer.producers.set(producer.id, producer);
    socket.to(peer.room).emit("newProducer", { producerId: producer.id, peerId: socket.id });
    cb({ id: producer.id });
  });

  socket.on("closeProducer", ({ producerId }) => {
    const peer = peers.get(socket.id);
    const producer = peer.producers.get(producerId);
    if (producer) {
      producer.close();
      peer.producers.delete(producerId);
      socket.to(peer.room).emit("producerClosed", { producerId, peerId: socket.id });
    }
  });

  socket.on("getProducers", (cb) => {
    const peer = peers.get(socket.id);
    const result: any[] = [];
    peers.forEach((p, id) => {
      if (id !== socket.id && p.room === peer.room) {
        p.producers.forEach((_: any, producerId: string) => {
          result.push({ producerId, peerId: id });
        });
      }
    });
    cb(result);
  });

  socket.on("consume", async ({ producerId, rtpCapabilities }, cb) => {
    const peer = peers.get(socket.id);
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return cb({ error: "Cannot consume" });
    }
    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    peer.consumers.set(consumer.id, consumer);
    cb({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    }); 
  });

  socket.on("resumeConsumer", async ({ consumerId }) => {
    const consumer = peers.get(socket.id).consumers.get(consumerId);
    if (consumer) await consumer.resume();
  });

  socket.on("disconnect", () => {
    const peer = peers.get(socket.id);
    if (peer) {
      peer.producers.forEach((p: any) => p.close());
      peer.consumers.forEach((c: any) => c.close());
      peer.sendTransport?.close();
      peer.recvTransport?.close();
      socket.to(peer.room).emit("peerLeft", { peerId: socket.id });
    }
    peers.delete(socket.id);
  });
});

export { app, server };