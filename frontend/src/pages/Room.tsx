import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { Device } from "mediasoup-client";
import { store } from "../lib/store";
import { Video, VideoOff, Mic, MicOff, Monitor, PhoneOff, Copy, Check, Users } from "lucide-react";

interface PeerInfo {
  peerId: string;
  name: string;
  stream: MediaStream;
}

export default function Room() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const user = store((state) => state.user);
  const clearUser = store((state) => state.clearUser);

  // States
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [videoOn, setVideoOn] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Connecting to SFU...");
  const [copied, setCopied] = useState(false);

  // Refs
  const myVideo = useRef<HTMLVideoElement>(null);
  const socket = useRef<Socket | null>(null);
  const device = useRef<Device | null>(null);
  const sendTransport = useRef<any>(null);
  const recvTransport = useRef<any>(null);
  const producers = useRef<{ video?: any; audio?: any; screen?: any }>({});
  const localStream = useRef<MediaStream>(new MediaStream());
  const ready = useRef(false);

  // Guard: Ensure user details exist
  useEffect(() => {
    if (!user?.Room || !user?.name) {
      navigate("/");
    }
  }, [user, navigate]);

  // Handle room joining & Mediasoup setup
  useEffect(() => {
    if (!roomId || !user?.name) return;

    const s = io("http://localhost:3000", {
      transports: ["websocket", "polling"],
    });
    socket.current = s;

    s.on("connect", () => {
      setConnectionStatus("Connected");
      s.emit("join", {
        Room: user.Room,
        Email: user.Email,
        name: user.name,
      });
    });

    s.on("routerCapabilities", async (rtpCapabilities: any) => {
      try {
        const d = new Device();
        await d.load({ routerRtpCapabilities: rtpCapabilities });
        device.current = d;

        // 1. Create SEND Transport
        s.emit("createTransport", { type: "send" }, (params: any) => {
          if (!params || params.error) {
            setConnectionStatus("Send Transport Error: " + params?.error);
            return;
          }

          sendTransport.current = d.createSendTransport(params);

          sendTransport.current.on(
            "connect",
            ({ dtlsParameters }: any, cb: () => void, errback: (err: any) => void) => {
              s.emit("connectTransport", { type: "send", dtlsParameters }, (res: any) => {
                if (res?.connected) cb();
                else errback(new Error(res?.error || "Connect failed"));
              });
            }
          );

          sendTransport.current.on(
            "produce",
            ({ kind, rtpParameters }: any, cb: (res: any) => void, errback: (err: any) => void) => {
              s.emit("produce", { kind, rtpParameters }, (res: any) => {
                if (res?.error) errback(new Error(res.error));
                else cb({ id: res.id });
              });
            }
          );

          // 2. Create RECV Transport
          s.emit("createTransport", { type: "recv" }, (recvParams: any) => {
            if (!recvParams || recvParams.error) {
              setConnectionStatus("Recv Transport Error: " + recvParams?.error);
              return;
            }

            recvTransport.current = d.createRecvTransport(recvParams);

            recvTransport.current.on(
              "connect",
              ({ dtlsParameters }: any, cb: () => void, errback: (err: any) => void) => {
                s.emit("connectTransport", { type: "recv", dtlsParameters }, (res: any) => {
                  if (res?.connected) cb();
                  else errback(new Error(res?.error || "Connect failed"));
                });
              }
            );

            ready.current = true;
            setConnectionStatus("Room Ready");

            // Listen for new producers in the room
            s.on("newProducer", ({ producerId, peerId, name }: any) => {
              consumeTrack(producerId, peerId, name);
            });

            // Fetch existing producers
            s.emit("getProducers", (producerList: any[]) => {
              if (Array.isArray(producerList)) {
                producerList.forEach(({ producerId, peerId, name }) => {
                  consumeTrack(producerId, peerId, name);
                });
              }
            });
          });
        });
      } catch (err: any) {
        setConnectionStatus("Mediasoup Load Error: " + err.message);
      }
    });

    // Handle closed producers
    s.on("producerClosed", ({ peerId }: { producerId?: string; peerId?: string }) => {
      if (peerId) {
        setPeers((prev) => {
          const updated = { ...prev };
          if (updated[peerId] && updated[peerId].stream.getTracks().length <= 1) {
            delete updated[peerId];
          }
          return updated;
        });
      }
    });

    // Handle peer disconnect
    s.on("peerLeft", ({ peerId }: { peerId: string }) => {
      setPeers((prev) => {
        const updated = { ...prev };
        delete updated[peerId];
        return updated;
      });
    });

    // Cleanup on unmount
    return () => {
      if (localStream.current) {
        localStream.current.getTracks().forEach((t) => t.stop());
      }
      s.disconnect();
    };
  }, [roomId, user]);

  // Consume a media track from a remote peer
  const consumeTrack = async (producerId: string, peerId: string, peerName?: string) => {
    const s = socket.current;
    const d = device.current;
    const recv = recvTransport.current;

    if (!s || !d || !recv) return;

    s.emit(
      "consume",
      { producerId, rtpCapabilities: d.rtpCapabilities },
      async (res: any) => {
        if (!res || res.error) return;

        try {
          const consumer = await recv.consume({
            id: res.id,
            producerId: res.producerId,
            kind: res.kind,
            rtpParameters: res.rtpParameters,
          });

          setPeers((prev) => {
            const existing = prev[peerId];
            const stream = existing ? existing.stream : new MediaStream();

            // Replace track of same kind if exists
            stream
              .getTracks()
              .filter((t) => t.kind === consumer.track.kind)
              .forEach((t) => stream.removeTrack(t));

            stream.addTrack(consumer.track);

            return {
              ...prev,
              [peerId]: {
                peerId,
                name: peerName || existing?.name || `Participant ${peerId.slice(0, 4)}`,
                stream,
              },
            };
          });

          // Resume consumer on server
          s.emit("resumeConsumer", { consumerId: res.id });
        } catch (err) {
          console.error("Failed to consume track:", err);
        }
      }
    );
  };

  // Toggle Camera
  const toggleVideo = async () => {
    if (!ready.current || !sendTransport.current) return;

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
      } catch (err: any) {
        alert("Camera permission denied or camera unavailable: " + err.message);
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
    }
  };

  // Toggle Microphone
  const toggleAudio = async () => {
    if (!ready.current || !sendTransport.current) return;

    if (!audioOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        localStream.current.addTrack(track);

        producers.current.audio = await sendTransport.current.produce({ track });
        setAudioOn(true);
      } catch (err: any) {
        alert("Microphone permission denied: " + err.message);
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
    }
  };

  // Toggle Screen Sharing
  const toggleScreen = async () => {
    if (!ready.current || !sendTransport.current) return;

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
        };

        producers.current.screen = await sendTransport.current.produce({ track });
        setScreenOn(true);
      } catch (err: any) {
        console.warn("Screen share cancelled or error:", err);
      }
    } else {
      if (producers.current.screen) {
        socket.current?.emit("closeProducer", { producerId: producers.current.screen.id });
        producers.current.screen.close();
        producers.current.screen = null;
      }
      setScreenOn(false);
    }
  };

  // Leave Room
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

  // Copy Room Link
  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Light Clean Top Header */}
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shadow-sm sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center text-white font-bold text-sm shadow-sm">
            <Video size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-slate-800 text-base leading-tight">
                Room #{roomId}
              </h1>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <p className="text-xs text-slate-500">
              {connectionStatus} • {Object.keys(peers).length + 1} participant(s)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-md transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "Copied!" : "Copy Link"}</span>
          </button>
          <button
            onClick={handleLeave}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-md shadow-sm transition-colors"
          >
            <PhoneOff size={13} />
            <span>Leave Call</span>
          </button>
        </div>
      </header>

      {/* Main Video Stage */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto flex flex-col justify-between">
        {/* Video Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
          {/* My Video Card */}
          <div className="bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm relative group">
            <div className="w-full aspect-video bg-slate-900 flex items-center justify-center relative overflow-hidden">
              <video
                ref={myVideo}
                autoPlay
                muted
                playsInline
                className={`w-full h-full object-cover scale-x-[-1] ${videoOn ? "block" : "hidden"}`}
              />
              {!videoOn && (
                <div className="flex flex-col items-center justify-center text-slate-400">
                  <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-white text-xl font-bold mb-2 shadow-inner">
                    {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
                  </div>
                  <span className="text-xs font-medium">Camera Off</span>
                </div>
              )}
              {/* Bottom label */}
              <div className="absolute bottom-2.5 left-2.5 bg-black/60 backdrop-blur-sm text-white px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5">
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

        {/* Empty State Callout when alone in room */}
        {Object.keys(peers).length === 0 && (
          <div className="my-8 text-center bg-white border border-dashed border-slate-300 rounded-xl p-8 max-w-md mx-auto">
            <Users size={32} className="mx-auto text-slate-400 mb-2" />
            <h3 className="text-sm font-bold text-slate-700 mb-1">
              You are the first person in this room!
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Share the room number or link with others so they can join your call.
            </p>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 mx-auto px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-md shadow-sm transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? "Link Copied!" : "Copy Invite Link"}</span>
            </button>
          </div>
        )}

        {/* Bottom Floating Control Bar */}
        <div className="sticky bottom-4 mx-auto mt-6 bg-white/95 backdrop-blur border border-slate-200 shadow-md rounded-2xl px-6 py-3 flex items-center gap-4">
          {/* Camera Button */}
          <button
            onClick={toggleVideo}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              videoOn
                ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {videoOn ? <VideoOff size={16} /> : <Video size={16} />}
            <span>{videoOn ? "Stop Video" : "Start Video"}</span>
          </button>

          {/* Microphone Button */}
          <button
            onClick={toggleAudio}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              audioOn
                ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {audioOn ? <MicOff size={16} /> : <Mic size={16} />}
            <span>{audioOn ? "Mute" : "Unmute"}</span>
          </button>

          {/* Screen Share Button */}
          <button
            onClick={toggleScreen}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              screenOn
                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Monitor size={16} />
            <span>{screenOn ? "Stop Sharing" : "Share Screen"}</span>
          </button>

          <div className="h-6 w-px bg-slate-200" />

          {/* End Call Button */}
          <button
            onClick={handleLeave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition-all"
          >
            <PhoneOff size={16} />
            <span>End Call</span>
          </button>
        </div>
      </main>
    </div>
  );
}

// Remote Peer Card Component
function PeerVideoCard({ name, stream }: { name: string; stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      const vTracks = stream.getVideoTracks();
      setHasVideoTrack(vTracks.length > 0 && vTracks[0].enabled);

      const handleTrackChange = () => {
        const vt = stream.getVideoTracks();
        setHasVideoTrack(vt.length > 0 && vt[0].enabled);
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
    <div className="bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm relative group">
      <div className="w-full aspect-video bg-slate-900 flex items-center justify-center relative overflow-hidden">
        <video
          ref={ref}
          autoPlay
          playsInline
          className={`w-full h-full object-cover scale-x-[-1] ${hasVideoTrack ? "block" : "hidden"}`}
        />
        {!hasVideoTrack && (
          <div className="flex flex-col items-center justify-center text-slate-400">
            <div className="w-16 h-16 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xl font-bold mb-2 shadow-inner">
              {name ? name.charAt(0).toUpperCase() : "P"}
            </div>
            <span className="text-xs font-medium">Camera Off</span>
          </div>
        )}
        <div className="absolute bottom-2.5 left-2.5 bg-black/60 backdrop-blur-sm text-white px-2.5 py-1 rounded-md text-xs font-semibold">
          {name}
        </div>
      </div>
    </div>
  );
}
