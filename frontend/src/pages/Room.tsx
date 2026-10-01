import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { Device } from "mediasoup-client";
import { store } from "../lib/store";
import { toast } from "../lib/toastStore";
import { Video, VideoOff, Mic, MicOff, Monitor, PhoneOff, Copy, Check, Users, UserCheck } from "lucide-react";

interface PeerInfo {
  peerId: string;
  name: string;
  stream: MediaStream;
  consumers?: Record<string, any>;
}

export default function Room() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const user = store((state) => state.user);
  const setUser = store((state) => state.setUser);
  const clearUser = store((state) => state.clearUser);

  // States
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [videoOn, setVideoOn] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");
  const [copied, setCopied] = useState(false);

  // Modal State for Direct Link / Refresh prompt
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  // Refs
  const myVideo = useRef<HTMLVideoElement>(null);
  const socket = useRef<Socket | null>(null);
  const device = useRef<Device | null>(null);
  const sendTransport = useRef<any>(null);
  const recvTransport = useRef<any>(null);
  const producers = useRef<{ video?: any; audio?: any; screen?: any }>({});
  const localStream = useRef<MediaStream>(new MediaStream());
  const ready = useRef(false);
  const consumedProducerIds = useRef<Set<string>>(new Set());

  // Guard: Ensure user details exist for current room
  useEffect(() => {
    if (!user || !user.name) {
      setShowPromptModal(true);
    } else if (roomId && Number(user.Room) !== Number(roomId)) {
      setUser({ ...user, Room: Number(roomId) });
    }
  }, [user, roomId, setUser]);

  // Handle room joining & Mediasoup setup
  useEffect(() => {
    if (!roomId || !user?.name) return;

    const s = io("http://localhost:3000", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socket.current = s;

    s.on("connect", () => {
      setConnectionStatus("Connected");
      toast.success("Connected", `Joined room #${roomId}`);
      s.emit("join", {
        Room: String(roomId),
        Email: user.Email,
        name: user.name,
      });
    });

    s.on("disconnect", (reason) => {
      setConnectionStatus("Disconnected");
      toast.warning("Connection Interrupted", `Disconnected (${reason}). Retrying...`);
    });

    s.on("connect_error", (err) => {
      setConnectionStatus("Connection Error");
      toast.error("Connection Error", "Server unreachable: " + err.message);
    });

    s.on("routerCapabilities", async (rtpCapabilities: any) => {
      try {
        const d = new Device();
        await d.load({ routerRtpCapabilities: rtpCapabilities });
        device.current = d;

        // 1. Create SEND Transport
        s.emit("createTransport", { type: "send" }, (params: any) => {
          if (!params || params.error) {
            const errStr = params?.error || "Send transport failed";
            setConnectionStatus("Transport Error");
            toast.error("Transport Error", errStr);
            return;
          }

          sendTransport.current = d.createSendTransport(params);

          sendTransport.current.on(
            "connect",
            ({ dtlsParameters }: any, cb: () => void, errback: (err: any) => void) => {
              s.emit("connectTransport", { type: "send", dtlsParameters }, (res: any) => {
                if (res?.connected) cb();
                else {
                  const error = new Error(res?.error || "Send transport connection failed");
                  toast.error("Transport Error", error.message);
                  errback(error);
                }
              });
            }
          );

          sendTransport.current.on(
            "produce",
            ({ kind, rtpParameters }: any, cb: (res: any) => void, errback: (err: any) => void) => {
              s.emit("produce", { kind, rtpParameters }, (res: any) => {
                if (res?.error) {
                  toast.error("Publish Error", res.error);
                  errback(new Error(res.error));
                } else cb({ id: res.id });
              });
            }
          );

          // 2. Create RECV Transport
          s.emit("createTransport", { type: "recv" }, (recvParams: any) => {
            if (!recvParams || recvParams.error) {
              const errStr = recvParams?.error || "Recv transport failed";
              setConnectionStatus("Transport Error");
              toast.error("Transport Error", errStr);
              return;
            }

            recvTransport.current = d.createRecvTransport(recvParams);

            recvTransport.current.on(
              "connect",
              ({ dtlsParameters }: any, cb: () => void, errback: (err: any) => void) => {
                s.emit("connectTransport", { type: "recv", dtlsParameters }, (res: any) => {
                  if (res?.connected) cb();
                  else {
                    const error = new Error(res?.error || "Recv transport connection failed");
                    toast.error("Transport Error", error.message);
                    errback(error);
                  }
                });
              }
            );

            ready.current = true;
            setConnectionStatus("Ready");

            s.on("newProducer", ({ producerId, peerId, name }: any) => {
              consumeTrack(producerId, peerId, name);
            });

            s.on("peerJoined", ({ name }: { peerId: string; name: string }) => {
              toast.info("Participant Joined", `${name} joined room #${roomId}`);
              fetchAndConsumeProducers();
            });

            fetchAndConsumeProducers();
          });
        });
      } catch (err: any) {
        setConnectionStatus("Device Error");
        toast.error("Device Load Error", err.message);
      }
    });

    s.on("producerClosed", ({ producerId, consumerId, peerId }: { producerId?: string; consumerId?: string; peerId?: string }) => {
      if (producerId) {
        consumedProducerIds.current.delete(producerId);
      }
      setPeers((prev) => {
        const updated = { ...prev };
        let targetId = peerId;

        if (!targetId && consumerId) {
          targetId = Object.keys(updated).find(
            (id) => updated[id].consumers && updated[id].consumers![consumerId]
          );
        }

        if (targetId && updated[targetId]) {
          const peerObj = updated[targetId];
          if (consumerId && peerObj.consumers?.[consumerId]) {
            try {
              peerObj.consumers[consumerId].track.stop();
            } catch {}
            delete peerObj.consumers[consumerId];
          }

          const activeTracks = peerObj.stream.getTracks().filter((t) => t.readyState === "live");
          if (activeTracks.length === 0) {
            delete updated[targetId];
          } else {
            updated[targetId] = {
              ...peerObj,
              stream: new MediaStream(activeTracks),
            };
          }
        }
        return updated;
      });
    });

    s.on("peerLeft", ({ peerId, name }: { peerId: string; name?: string }) => {
      toast.info("Participant Left", `${name || "A participant"} left.`);
      setPeers((prev) => {
        const updated = { ...prev };
        if (updated[peerId]) {
          try {
            updated[peerId].stream.getTracks().forEach((t) => t.stop());
          } catch {}
          delete updated[peerId];
        }
        return updated;
      });
    });

    const fetchAndConsumeProducers = () => {
      if (!s) return;
      s.emit("getProducers", (producerList: any[]) => {
        if (Array.isArray(producerList)) {
          producerList.forEach(({ producerId, peerId, name }) => {
            consumeTrack(producerId, peerId, name);
          });
        }
      });
    };

    return () => {
      if (localStream.current) {
        localStream.current.getTracks().forEach((t) => t.stop());
      }
      s.disconnect();
      consumedProducerIds.current.clear();
    };
  }, [roomId, user]);

  const consumeTrack = async (producerId: string, peerId: string, peerName?: string) => {
    const s = socket.current;
    const d = device.current;
    const recv = recvTransport.current;

    if (!s || !d || !recv) return;
    if (consumedProducerIds.current.has(producerId)) return;
    consumedProducerIds.current.add(producerId);

    s.emit(
      "consume",
      { producerId, rtpCapabilities: d.rtpCapabilities },
      async (res: any) => {
        if (!res || res.error) {
          consumedProducerIds.current.delete(producerId);
          return;
        }

        try {
          const consumer = await recv.consume({
            id: res.id,
            producerId: res.producerId,
            kind: res.kind,
            rtpParameters: res.rtpParameters,
          });

          setPeers((prev) => {
            const existing = prev[peerId];
            const oldStream = existing?.stream;

            const remainingTracks = oldStream
              ? oldStream.getTracks().filter((t) => t.kind !== consumer.track.kind && t.readyState === "live")
              : [];

            const newTracks = [...remainingTracks, consumer.track];
            const newStream = new MediaStream(newTracks);

            return {
              ...prev,
              [peerId]: {
                peerId,
                name: peerName || existing?.name || `Participant ${peerId.slice(0, 4)}`,
                stream: newStream,
                consumers: {
                  ...(existing?.consumers || {}),
                  [consumer.id]: consumer,
                },
              },
            };
          });

          s.emit("resumeConsumer", { consumerId: res.id });
        } catch (err: any) {
          consumedProducerIds.current.delete(producerId);
          toast.error("Media Error", err.message || "Failed to receive media track");
        }
      }
    );
  };

  const toggleVideo = async () => {
    if (!ready.current || !sendTransport.current) {
      toast.warning("Room Status", "Media transport connecting...");
      return;
    }

    if (!videoOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 25 } },
        });
        const track = stream.getVideoTracks()[0];
        localStream.current.addTrack(track);

        if (myVideo.current) {
          myVideo.current.srcObject = localStream.current;
        }

        producers.current.video = await sendTransport.current.produce({ track });
        setVideoOn(true);
        toast.info("Video Active", "Camera turned on.");
      } catch (err: any) {
        toast.error("Camera Error", err.message || "Camera unavailable or permission denied");
      }
    } else {
      if (producers.current.video) {
        socket.current?.emit("closeProducer", { producerId: producers.current.video.id });
        producers.current.video.close();
        producers.current.video = null;
      }
      localStream.current.getVideoTracks().forEach((t) => {
        t.stop();
        localStream.current.removeTrack(t);
      });
      if (myVideo.current) {
        myVideo.current.srcObject = localStream.current;
      }
      setVideoOn(false);
      toast.info("Video Off", "Camera turned off.");
    }
  };

  const toggleAudio = async () => {
    if (!ready.current || !sendTransport.current) {
      toast.warning("Room Status", "Media transport connecting...");
      return;
    }

    if (!audioOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        localStream.current.addTrack(track);

        producers.current.audio = await sendTransport.current.produce({ track });
        setAudioOn(true);
        toast.info("Microphone Active", "Microphone unmuted.");
      } catch (err: any) {
        toast.error("Microphone Error", err.message || "Microphone permission denied");
      }
    } else {
      if (producers.current.audio) {
        socket.current?.emit("closeProducer", { producerId: producers.current.audio.id });
        producers.current.audio.close();
        producers.current.audio = null;
      }
      localStream.current.getAudioTracks().forEach((t) => {
        t.stop();
        localStream.current.removeTrack(t);
      });
      setAudioOn(false);
      toast.info("Microphone Muted", "Microphone muted.");
    }
  };

  const toggleScreen = async () => {
    if (!ready.current || !sendTransport.current) {
      toast.warning("Room Status", "Media transport connecting...");
      return;
    }

    if (!screenOn) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const track = stream.getVideoTracks()[0];

        track.onended = () => {
          setScreenOn(false);
          if (producers.current.screen) {
            socket.current?.emit("closeProducer", { producerId: producers.current.screen.id });
            producers.current.screen.close();
            producers.current.screen = null;
          }
          toast.info("Screen Share Stopped", "Stopped sharing screen.");
        };

        producers.current.screen = await sendTransport.current.produce({ track });
        setScreenOn(true);
        toast.info("Screen Share Active", "Sharing screen.");
      } catch (err: any) {
        if (err.name !== "NotAllowedError") {
          toast.error("Screen Share Error", err.message || "Screen share failed");
        }
      }
    } else {
      if (producers.current.screen) {
        socket.current?.emit("closeProducer", { producerId: producers.current.screen.id });
        producers.current.screen.close();
        producers.current.screen = null;
      }
      setScreenOn(false);
      toast.info("Screen Share Stopped", "Stopped sharing screen.");
    }
  };

  const handleLeave = () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach((t) => t.stop());
    }
    if (socket.current) {
      socket.current.disconnect();
    }
    clearUser();
    navigate("/");
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success("Copied", "Room link copied to clipboard.");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGuestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) {
      toast.error("Input Error", "Please enter your name.");
      return;
    }
    if (!guestEmail.trim()) {
      toast.error("Input Error", "Please enter your email.");
      return;
    }
    const newDetails = {
      name: guestName.trim(),
      Email: guestEmail.trim(),
      Room: Number(roomId || 101),
    };
    setUser(newDetails);
    setShowPromptModal(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans">
      {/* Top Header Navbar */}
      <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#393939] text-white flex items-center justify-center font-bold text-xs shadow-xs">
            <Video size={16} />
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-semibold text-slate-900 text-sm tracking-tight">
              Room #{roomId}
            </h1>
            <span className="text-xs text-slate-500 border-l border-slate-200 pl-3">
              {connectionStatus} • {Object.keys(peers).length + 1} participant(s)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 text-xs font-medium rounded-lg border border-slate-300 transition-colors shadow-xs cursor-pointer"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "Copied" : "Copy Link"}</span>
          </button>
          <button
            onClick={handleLeave}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <PhoneOff size={13} />
            <span>Leave Call</span>
          </button>
        </div>
      </header>

      {/* Main Stage */}
      <main className="flex-1 p-6 max-w-6xl w-full mx-auto flex flex-col justify-between">
        {/* Video Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
          {/* My Video Card */}
          <div className="bg-[#2f332c] rounded-2xl overflow-hidden border border-slate-700/60 shadow-sm relative group">
            <div className="w-full aspect-video flex items-center justify-center relative">
              <video
                ref={myVideo}
                autoPlay
                muted
                playsInline
                className={`w-full h-full object-cover scale-x-[-1] ${videoOn ? "block" : "hidden"}`}
              />
              {!videoOn && (
                <div className="flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-[#636363] text-white flex items-center justify-center text-xl font-bold border border-slate-700 shadow-sm uppercase tracking-wider">
                    {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium bg-slate-800/90 px-3 py-1 rounded-full border border-slate-700 mt-2.5">
                    <VideoOff size={13} />
                    <span>Camera Off</span>
                  </div>
                </div>
              )}
              {/* Bottom Label Tag */}
              <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-xs text-white px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-2 border border-white/10">
                <span>{user?.name || "You"} (You)</span>
                {audioOn ? (
                  <Mic size={12} className="text-emerald-400" />
                ) : (
                  <MicOff size={12} className="text-rose-400" />
                )}
              </div>
            </div>
          </div>

          {/* Peer Video Cards */}
          {Object.entries(peers).map(([id, peer]) => (
            <PeerVideoCard key={id} name={peer.name} stream={peer.stream} />
          ))}
        </div>

        {/* Empty State when alone */}
        {Object.keys(peers).length === 0 && (
          <div className="my-10 text-center bg-white border border-slate-200 rounded-2xl p-8 max-w-sm mx-auto shadow-xs">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-700 mb-2">
              <Users size={20} />
            </div>
            <h3 className="text-xs font-bold text-slate-900 mb-1">
              You are the only person in this room
            </h3>
            <p className="text-[11px] text-slate-500 mb-4">
              Share the invite link with others to start talking.
            </p>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 mx-auto px-3.5 py-1.5 bg-slate-900 text-white hover:bg-black text-xs font-semibold rounded-lg shadow-xs cursor-pointer"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "Link Copied" : "Copy Invite Link"}</span>
            </button>
          </div>
        )}

        {/* Floating Bottom Control Toolbar */}
        <div className="sticky bottom-4 mx-auto mt-6 bg-white border border-slate-200 shadow-md rounded-full px-5 py-2.5 flex items-center gap-3 z-20">
          <button
            onClick={toggleVideo}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${
              videoOn ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300"
            }`}
          >
            {videoOn ? <VideoOff size={14} /> : <Video size={14} />}
            <span>{videoOn ? "Stop Video" : "Start Video"}</span>
          </button>

          <button
            onClick={toggleAudio}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${
              audioOn ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300"
            }`}
          >
            {audioOn ? <MicOff size={14} /> : <Mic size={14} />}
            <span>{audioOn ? "Mute" : "Unmute"}</span>
          </button>

          <button
            onClick={toggleScreen}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${
              screenOn ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300"
            }`}
          >
            <Monitor size={14} />
            <span>{screenOn ? "Stop Share" : "Share Screen"}</span>
          </button>

          <div className="h-5 w-px bg-slate-300 mx-1" />

          <button
            onClick={handleLeave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-all cursor-pointer shadow-xs"
          >
            <PhoneOff size={14} />
            <span>End Call</span>
          </button>
        </div>
      </main>

      {/* Guest Registration Modal */}
      {showPromptModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center gap-2.5 mb-3">
              <UserCheck size={18} className="text-slate-900" />
              <h3 className="font-bold text-slate-900 text-sm">Join Room #{roomId}</h3>
            </div>

            <form onSubmit={handleGuestSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Your Name</label>
                <input
                  type="text"
                  required
                  placeholder="Enter name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Your Email</label>
                <input
                  type="email"
                  required
                  placeholder="Enter email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-800 border border-slate-300 text-xs font-medium hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-black shadow-xs"
                >
                  Join Call
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Remote Peer Video Card Component
function PeerVideoCard({ name, stream }: { name: string; stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      const vTracks = stream.getVideoTracks();
      setHasVideoTrack(vTracks.length > 0 && vTracks[0].enabled && vTracks[0].readyState === "live");

      const handleTrackChange = () => {
        const vt = stream.getVideoTracks();
        setHasVideoTrack(vt.length > 0 && vt[0].enabled && vt[0].readyState === "live");
      };

      stream.addEventListener("addtrack", handleTrackChange);
      stream.addEventListener("removetrack", handleTrackChange);

      return () => {
        stream.removeEventListener("addtrack", handleTrackChange);
        stream.removeEventListener("removetrack", handleTrackChange);
      };
    }
  }, [stream]);

  return (
    <div className="bg-[#2f332c] rounded-2xl overflow-hidden border border-slate-700/60 shadow-sm relative group">
      <div className="w-full aspect-video flex items-center justify-center relative">
        <video
          ref={ref}
          autoPlay
          playsInline
          className={`w-full h-full object-cover scale-x-[-1] ${hasVideoTrack ? "block" : "hidden"}`}
        />
        {!hasVideoTrack && (
          <div className="flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-2xl bg-[#636363] text-white flex items-center justify-center text-xl font-bold border border-slate-700 shadow-sm uppercase tracking-wider">
              {name ? name.charAt(0).toUpperCase() : "P"}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium bg-slate-800/90 px-3 py-1 rounded-full border border-slate-700 mt-2.5">
              <VideoOff size={13} />
              <span>Camera Off</span>
            </div>
          </div>
        )}
        <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-xs text-white px-2.5 py-1 rounded-lg text-xs font-medium border border-white/10">
          {name}
        </div>
      </div>
    </div>
  );
}
