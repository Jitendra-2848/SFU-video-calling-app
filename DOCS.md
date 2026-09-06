# WebRTC SFU Architecture & API Documentation

A comprehensive technical reference for the Selective Forwarding Unit (SFU) multi-party video conferencing engine.

---

## Contents
1. [System Architecture](#1-system-architecture)
2. [Signaling Protocol Specification (Socket.io)](#2-signaling-protocol-specification-socketio)
3. [Mediasoup Worker & Router Topology](#3-mediasoup-worker--router-topology)
4. [Client State Machine & Media Lifecycle](#4-client-state-machine--media-lifecycle)
5. [Network & Firewall Requirements](#5-network--firewall-requirements)
6. [Production Deployment Guide](#6-production-deployment-guide)
7. [Troubleshooting & FAQ](#7-troubleshooting--faq)

---

## 1. System Architecture

```
                               +----------------------------------------+
                               |              SFU SERVER                |
                               |  Node.js + Mediasoup C++ Workers      |
                               +-------------------+--------------------+
                                                   |
                        Signaling (WebSocket)      |     Media (SRTP/UDP)
                        Socket.io / Port 3000      |     Ports 3100-3500
                                                   |
                     +-----------------------------+-----------------------------+
                     |                                                           |
           +---------v---------+                                       +---------v---------+
           |     Client A      |                                       |     Client B      |
           |  (Browser WebRTC) |                                       |  (Browser WebRTC) |
           |  - Send Transport |                                       |  - Send Transport |
           |  - Recv Transport |                                       |  - Recv Transport |
           +-------------------+                                       +-------------------+
```

### Why Selective Forwarding?
- **P2P Mesh**: Every peer connects directly to every other peer ($N \times (N-1)$ streams). Upload bandwidth explodes when more than 3 participants join.
- **MCU (Mixing)**: Decodes, re-encodes, and mixes all video streams into a single composite stream on the server. Causes huge server CPU load and adds 200-400ms encoding delay.
- **SFU (Our Architecture)**:
  - Each participant sends **1 uplink** stream to the server.
  - The server inspects RTP packet headers and selectively routes packets to other peers in the room without transcoding.
  - Sub-100ms latency with minimal server CPU usage.

---

## 2. Signaling Protocol Specification (Socket.io)

All signaling between clients and the SFU server occurs over WebSocket connections on port `3000`.

### A. Client-to-Server Events

| Event Name | Payload | Description |
| :--- | :--- | :--- |
| `join` | `{ Room: number, name: string, Email: string }` | Registers peer in the specified room. Server responds with `routerCapabilities`. |
| `createTransport` | `{ type: "send" \| "recv" }` | Requests the creation of a WebRtcTransport on the Mediasoup router. Returns ICE & DTLS parameters. |
| `connectTransport` | `{ type: "send" \| "recv", dtlsParameters: object }` | Completes DTLS handshake for the transport. |
| `produce` | `{ kind: "video" \| "audio", rtpParameters: object }` | Publishes a media track to the send transport. Returns `{ id: producerId }`. |
| `getProducers` | `(callback) => void` | Queries all active producers published by other peers in the room. |
| `consume` | `{ producerId: string, rtpCapabilities: object }` | Requests permission to consume another peer's stream on the recv transport. |
| `resumeConsumer` | `{ consumerId: string }` | Unpauses the consumer on the server once the client pipeline is ready. |
| `closeProducer` | `{ producerId: string }` | Closes and removes a published media track (e.g. mute video/audio). |

---

### B. Server-to-Client Events

| Event Name | Payload | Description |
| :--- | :--- | :--- |
| `routerCapabilities` | `RtpCapabilities` | Router media codecs (VP8, H.264, Opus) and header extensions needed to initialize the client `Device`. |
| `newProducer` | `{ producerId: string, peerId: string, name: string, kind: string }` | Broadcast to the room when a peer begins publishing a new video or audio track. |
| `producerClosed` | `{ producerId: string, peerId: string }` | Broadcast when a peer stops sending a track. |
| `peerJoined` | `{ peerId: string, name: string }` | Informs room members of a new participant. |
| `peerLeft` | `{ peerId: string, name: string }` | Broadcast when a participant disconnects or leaves. |

---

### C. Complete Signaling Sequence Diagram

```
Browser Client                                                    SFU Server
     |                                                                 |
     |------------------ 1. emit("join", { Room, name }) ------------->|
     |<----------------- 2. emit("routerCapabilities", rtpCap) --------|
     |                                                                 |
     |  [device.load({ routerRtpCapabilities })]                       |
     |                                                                 |
     |------------------ 3. emit("createTransport", { type: "send" }) ->|
     |<----------------- 4. callback({ id, iceParams, dtlsParams }) ---|
     |                                                                 |
     |  [device.createSendTransport(params)]                           |
     |  [transport.on("connect") -> emit("connectTransport")]          |
     |  [transport.on("produce") -> emit("produce", { kind, rtp })]    |
     |                                                                 |
     |------------------ 5. emit("createTransport", { type: "recv" }) ->|
     |<----------------- 6. callback({ id, iceParams, dtlsParams }) ---|
     |                                                                 |
     |  [device.createRecvTransport(params)]                           |
     |  [transport.on("connect") -> emit("connectTransport")]          |
     |                                                                 |
     |------------------ 7. emit("getProducers") --------------------->|
     |<----------------- 8. callback([{ producerId, peerId, name }]) --|
     |                                                                 |
     |--- (For each producer): 9. emit("consume", { producerId }) ---->|
     |<----------------- 10. callback({ id, kind, rtpParameters }) ----|
     |                                                                 |
     |  [recvTransport.consume({ id, kind, rtpParameters })]           |
     |  [attach track to HTMLMediaElement]                             |
     |------------------ 11. emit("resumeConsumer", { consumerId }) -->|
     |                                                                 |
     |<================= Media RTP Packets Flow (UDP) ================>|
```

---

## 3. Mediasoup Worker & Router Topology

Mediasoup distributes media routing across C++ worker processes:

```
[Node.js Process]
       |
       +---> Mediasoup Worker #0 (CPU Core 0, UDP Ports 3100-3199)
       |        +-- SFU Router (Room 101)
       |               +-- Send Transport (User A)
       |               +-- Recv Transport (User B)
       |
       +---> Mediasoup Worker #1 (CPU Core 1, UDP Ports 3200-3299)
       +---> Mediasoup Worker #2 (CPU Core 2, UDP Ports 3300-3399)
       +---> Mediasoup Worker #N (CPU Core N)
```

### Worker Allocation (`backend/mediasoup/worker.ts`):
- Automatically discovers CPU core count via `os.cpus().length`.
- Spawns one native C++ worker process per core (capped at 8 for optimal overhead).
- Monitors `worker.on("died")` to prevent silent server failures.

---

## 4. Client State Machine & Media Lifecycle

### Tracks and Transports:
- **Local Stream**:
  - `localStream.current` holds outgoing webcam and microphone tracks.
  - Turning video off calls `producer.close()`, stops the hardware track (`track.stop()`), and emits `closeProducer`.
- **Remote Streams**:
  - Maintained in `peers: Record<string, { peerId, name, stream }>`.
  - When an incoming video track arrives, it is attached to the existing `MediaStream` for that peer.
  - Handled cleanly in `useEffect` hooks with `addtrack` and `removetrack` event listeners.

---

## 5. Network & Firewall Requirements

WebRTC requires two classes of network ports:

1. **Signaling Port (TCP 3000)**: Standard HTTP / WebSocket port used by Socket.io.
2. **RTC Media Ports (UDP 3100–3500)**: Range of dynamic UDP ports used by Mediasoup for SRTP media packets.

### Cloud Firewall (AWS Security Group / DigitalOcean):
```
Type        Protocol   Port Range    Source
Custom TCP  TCP        3000          0.0.0.0/0
Custom UDP  UDP        3100 - 3500   0.0.0.0/0
```

---

## 6. Production Deployment Guide

### A. Environment Configuration (`backend/.env`)
```env
PORT=3000
# IMPORTANT: In production, set ANNOUNCED_IP to your public Elastic IP or domain:
ANNOUNCED_IP=203.0.113.45
RTC_MIN_PORT=3100
RTC_MAX_PORT=3500
```

### B. Nginx Reverse Proxy with SSL (WSS/HTTPS)
```nginx
server {
    listen 80;
    server_name call.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name call.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/call.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/call.yourdomain.com/privkey.pem;

    # Frontend Single Page App
    location / {
        root /var/www/sfu-frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend Socket.io Signaling
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

---

## 7. Troubleshooting & FAQ

### Q: Why do I see a black screen when connecting from another computer or mobile phone?
**A**: By default, WebRTC advertises `127.0.0.1` as the ICE candidate IP. Other machines on your network cannot route to `127.0.0.1`.
Our updated config automatically detects your non-internal Wi-Fi/Ethernet IPv4 address. You can also explicitly set `ANNOUNCED_IP=192.168.1.X` in `backend/.env`.

### Q: Does this require a TURN server?
**A**: For local networks and open internet connections, STUN/host candidates succeed directly. If clients are behind restrictive corporate symmetric NATs or mobile carrier firewalls, a TURN server (e.g. `coturn`) is recommended.

### Q: How many participants can join a room?
**A**: Because each participant uploads only 1 video stream, a modern 4-core server easily handles 30–50 concurrent participants in a single room, or hundreds across multiple rooms distributed over worker cores.
