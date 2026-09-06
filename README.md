# SFU WebRTC Group Video Calling Application

A production-ready, high-performance Selective Forwarding Unit (SFU) multi-party video calling platform built with **Mediasoup (C++ WebRTC core)**, **Node.js / Express**, **Socket.io**, and **React + Vite (TypeScript & Tailwind CSS)**.

> **Full Technical Documentation & API Reference**: See [DOCS.md](./DOCS.md) for sequence diagrams, Socket.io protocol specifications, and deployment guides.

---

## Table of Contents
- [1. Overview & Problem Statement](#1-overview--problem-statement)
- [2. Why SFU? (Mesh vs MCU vs SFU)](#2-why-sfu-mesh-vs-mcu-vs-sfu)
- [3. Mediasoup SFU Architecture](#3-mediasoup-sfu-architecture)
- [4. Media Negotiation & Signaling Flow](#4-media-negotiation--signaling-flow)
- [5. Project Structure](#5-project-structure)
- [6. Getting Started](#6-getting-started)
- [7. Configuration & Environment Variables](#7-configuration--environment-variables)
- [8. Troubleshooting & Common Pitfalls](#8-troubleshooting--common-pitfalls)
- [9. Tech Stack & Credits](#9-tech-stack--credits)

---

## 1. Overview & Problem Statement

Most standard WebRTC tutorials demonstrate simple Peer-to-Peer (P2P Mesh) video calling. While P2P works well for 1-on-1 calls, it quickly breaks down when 3 or more people join:
- In a 5-person mesh call, each client must upload their video 4 times ($N - 1$) and download 4 video streams.
- For 8 participants, each user is sending 7 video streams and receiving 7 streams—causing home Wi-Fi choke, extreme CPU heating, and dropped frames.

This application implements a **Selective Forwarding Unit (SFU)**:
1. **Single Uplink**: Every participant sends their video and audio to the media server **exactly once**.
2. **Selective Forwarding**: The server forwards those incoming encrypted RTP packets to all other participants in the room without decoding or re-encoding.
3. **Ultra-Low Latency & High Scalability**: Drastically cuts client bandwidth requirements and eliminates heavy server-side video transcoding.

---

## 2. Why SFU? (Mesh vs MCU vs SFU)

```
      MESH (P2P)                     MCU (Multipoint)                    SFU (Selective Forwarding)

     [A] <---> [B]                     [A]      [B]                       [A]      [B]
       \       /                         \      /                           \      /
        \     /                           v    v                             v    v
         \   /                         +----------+                       +----------+
          [C]                          | Transcode|                       | Forward  |
                                       | & Mix    |                       | Packets  |
   N*(N-1) connections                 +----------+                       +----------+
   High Client Uplink                       |                                  |    |
   Fails at >4 peers                        v                                  v    v
                                      Single Stream                      Separate Streams
                                     High Server CPU                     Low Server CPU & Bandwidth
```

| Metric | Peer-to-Peer (Mesh) | Multipoint Control Unit (MCU) | Selective Forwarding Unit (SFU) |
| :--- | :--- | :--- | :--- |
| **Client Upload** | $N - 1$ streams (Severe) | 1 stream (Optimal) | **1 stream (Optimal)** |
| **Client Download** | $N - 1$ streams | 1 mixed stream | **$N - 1$ individual streams** |
| **Server CPU Usage**| Zero (No media server) | **Extremely High** (Decodes & encodes video) | **Very Low** (Routes raw network packets) |
| **Latency** | Direct (Sub-50ms) | High (>250ms due to transcoding) | **Ultra-Low (<80ms forwarding)** |
| **Layout Control** | Client-side flexible | Rigid (Server hardcodes layout) | **Full client-side layout control** |

---

## 3. Mediasoup SFU Architecture

Mediasoup acts as a low-level, high-throughput media routing library written in C++ and controlled from Node.js via inter-process pipes.

```
+-------------------------------------------------------------------------------+
|                                Node.js Host                                   |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | Mediasoup Worker (Runs on a single CPU core in C++)                     |  |
|  |                                                                         |  |
|  |   +------------------------------------------------------------------+  |  |
|  |   | Router (Media boundary / Room)                                   |  |  |
|  |   |                                                                  |  |  |
|  |   |   WebRtcTransport (Send) <--- WebRTC/ICE/DTLS <--- Client A      |  |  |
|  |   |     +-- Producer (Video Track)                                   |  |  |
|  |   |     +-- Producer (Audio Track)                                   |  |  |
|  |   |                                                                  |  |  |
|  |   |   WebRtcTransport (Recv) ---> WebRTC/ICE/DTLS ---> Client B      |  |  |
|  |   |     +-- Consumer (for Client A's Video)                          |  |  |
|  |   |     +-- Consumer (for Client A's Audio)                          |  |  |
|  |   +------------------------------------------------------------------+  |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

### Core Primitives:
- **Worker**: A native OS process bound to a CPU core. To maximize throughput, the server pools multiple workers across available CPU cores.
- **Router**: An independent RTP routing entity (maps to a video call room). Codecs (VP8, H.264, Opus) are negotiated at the router level.
- **WebRtcTransport**: An ICE + DTLS connection representing a WebRTC peer connection. Each client establishes:
  - **One Send Transport**: Dedicated for all outgoing media tracks (camera, mic, screen share).
  - **One Recv Transport**: Dedicated for consuming all incoming media tracks from other peers.
- **Producer**: An incoming RTP stream published by a client to the SFU router.
- **Consumer**: An outgoing RTP stream dispatched from the SFU router to a receiving client.

---

## 4. Media Negotiation & Signaling Flow

The WebRTC state machine coordinates between the browser and Mediasoup via Socket.io:

```
 Client (Browser)                           SFU Server (Node + Mediasoup)
        |                                                 |
        |--- 1. socket.emit("join", { Room, name }) ------>|
        |<-- 2. socket.emit("routerCapabilities", rtp) ---|
        |                                                 |
        |--- 3. socket.emit("createTransport", send) ---->| (Server creates Send Transport)
        |<-- 4. returns { id, iceParams, dtlsParams } ----|
        |                                                 |
        |--- 5. sendTransport.produce({ track }) -------->| (Transmits DTLS parameters)
        |<-- 6. returns { id: producerId } ---------------|
        |                                                 |
        |                                                 |--- 7. socket.to(room).emit("newProducer") ---> (Other Peers)
        |                                                 |
        |--- 8. socket.emit("createTransport", recv) ---->| (Server creates Recv Transport)
        |<-- 9. returns { id, iceParams, dtlsParams } ----|
        |                                                 |
        |--- 10. socket.emit("consume", { producerId }) ->| (Server creates Consumer)
        |<-- 11. returns { id, kind, rtpParameters } -----|
        |                                                 |
        |--- 12. socket.emit("resumeConsumer") ---------->| (Server starts forwarding RTP packets)
        |                                                 |
```

---

## 5. Project Structure

```
.
├── backend/                     # Node.js + TypeScript Mediasoup SFU Server
│   ├── index.ts                 # Server entry point & periodic CPU/memory telemetry
│   ├── package.json
│   ├── tsconfig.json
│   ├── mediasoup/
│   │   ├── config.ts            # Dynamic LAN IP detection, port ranges, VP8/H.264/Opus codecs
│   │   └── worker.ts            # Worker process pool manager & core distribution
│   └── ws/
│       └── socket.ts            # Socket.io signaling & WebRTC transport/producer/consumer handlers
│
└── frontend/                    # React + Vite (TypeScript & Tailwind CSS)
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── App.tsx              # React Router setup
        ├── main.tsx
        ├── index.css            # Tailwind directives
        ├── lib/
        │   └── store.ts         # Zustand store with sessionStorage persistence
        └── pages/
            ├── Lobby.tsx        # Clean entry lobby for room no, name, and email
            └── Room.tsx         # Multi-party video grid, mic/cam toggles, screen share, and leave call
```

---

## 6. Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended).
- **C++ Build Tools**: Mediasoup compiles native worker binaries:
  - **Windows**: Visual Studio C++ Build Tools (`npm install -g windows-build-tools` or install via Visual Studio Installer).
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: `build-essential`, `python3`, `gcc`, `g++`.

---

### 1. Setup and Run Backend

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Run backend dev server with nodemon + ts-node
npm run dev
```

*The server will start on `http://localhost:3000`, detect your local network IP, and spawn Mediasoup workers.*

---

### 2. Setup and Run Frontend

In a new terminal:

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start Vite dev server
npm run dev
```

*The client web application will start on `http://localhost:5173`.*

---

### 3. Testing Multi-Party Calling
1. Open `http://localhost:5173` in your browser.
2. Enter your Name (e.g. `Alice`), Room Number `101`, and an Email.
3. Click **Join Room** and grant Camera / Microphone permissions.
4. Open a **second tab** or an **Incognito window** at `http://localhost:5173`.
5. Enter a different name (e.g. `Bob`), enter the **same Room Number `101`**, and click Join Room.
6. Both participants will see each other's live video stream with real-time audio!
7. Use the bottom control bar to toggle your Camera, mute/unmute your Microphone, or share your screen.

---

## 7. Configuration & Environment Variables

Create a `.env` file in `backend/` to customize network settings:

```env
# Port for HTTP & WebSocket server (default: 3000)
PORT=3000

# WebRTC Announced IP (default: auto-detected non-internal IPv4 LAN address)
# If deploying to AWS, GCP, or a VPS with a public IP, set your public Elastic IP here:
ANNOUNCED_IP=192.168.1.100

# Mediasoup RTC Port Range (ensure these UDP ports are open in firewall)
RTC_MIN_PORT=3100
RTC_MAX_PORT=3500
```

---

## 8. Troubleshooting & Common Pitfalls

### 1. Black Screen / Video Not Connecting Between Devices
- **Cause**: By default, WebRTC creates ICE candidates using `127.0.0.1`. If another phone or laptop joins across Wi-Fi, it cannot reach `127.0.0.1`.
- **Solution**: Our updated `backend/mediasoup/config.ts` automatically detects your actual local Wi-Fi / Ethernet IPv4 address. You can also manually set `ANNOUNCED_IP=192.168.X.X` in `backend/.env`.

### 2. Audio Autoplay Blocked
- **Cause**: Modern browsers block unmuted audio playback if the user has not interacted with the DOM yet.
- **Solution**: The application handles muted preview by default and attaches remote audio tracks cleanly to media elements.

### 3. UDP Port Access / Firewall
- Ensure UDP ports `3100-3500` are permitted through your operating system firewall and router NAT.

---

## 9. Tech Stack & Credits

- **Media Server (SFU)**: [Mediasoup](https://mediasoup.org/) v3
- **Signaling**: [Socket.io](https://socket.io/)
- **Backend**: Node.js, Express, TypeScript, ts-node
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS
- **State Management**: Zustand (persisted via `sessionStorage`)

**Developed by [Jitendra Prajapati](https://github.com/Jitendra-2848)**
Architected for scalable, low-latency WebRTC media routing.