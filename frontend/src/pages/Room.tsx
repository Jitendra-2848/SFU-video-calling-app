import { useEffect, useRef, useState } from "react";
import {
  useNavigate,
  useParams,
  type NavigateFunction,
} from "react-router-dom";
import { io } from "socket.io-client";
import { Device } from "mediasoup-client";
import { store } from "../lib/store";

export default function Room() {
  const { id: roomId } = useParams();
  const navigate: NavigateFunction = useNavigate();
  const user = store((state) => state.user);
  useEffect(() => {
    if (!user?.Room || !user?.Email || !user?.name) {
      navigate("/");
      console.log("not found");
    }
  }, []);
  const [peers, setPeers] = useState<Record<string, MediaStream>>({});
  const [videoOn, setVideoOn] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const myVideo = useRef<HTMLVideoElement>(null);
  const socket = useRef<any>(null);
  const device = useRef<any>(null);
  const sendTransport = useRef<any>(null);
  const recvTransport = useRef<any>(null);
  const producers = useRef<any>({});
  const localStream = useRef(new MediaStream());
  const ready = useRef(false);

  function getPrefs() {
    return JSON.parse(
      localStorage.getItem("prefs") || '{"video":false,"audio":false}',
    );
  }
  function savePrefs(video: boolean, audio: boolean) {
    localStorage.setItem("prefs", JSON.stringify({ video, audio }));
  }

  async function consume(producerId: string, peerId: string) {
    socket.current.emit(
      "consume",
      { producerId, rtpCapabilities: device.current.rtpCapabilities },
      async (res: any) => {
        if (res.error) return;

        const consumer = await recvTransport.current.consume({
          id: res.id,
          producerId: res.producerId,
          kind: res.kind,
          rtpParameters: res.rtpParameters,
        });

        setPeers((prev) => {
          const stream = prev[peerId] || new MediaStream();
          stream.addTrack(consumer.track);
          return { ...prev, [peerId]: stream };
        });

        socket.current.emit("resumeConsumer", { consumerId: res.id });
      },
    );
  }

  async function toggleVideo() {
    if (!ready.current) return;

    if (!videoOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      localStream.current.addTrack(track);
      myVideo.current!.srcObject = localStream.current;
      producers.current.video = await sendTransport.current.produce({ track });
      setVideoOn(true);
      savePrefs(true, audioOn);
    } else {
      socket.current.emit("closeProducer", {
        producerId: producers.current.video.id,
      });
      producers.current.video.close();
      localStream.current.getVideoTracks().forEach((t) => {
        t.stop();
        localStream.current.removeTrack(t);
      });
      myVideo.current!.srcObject = localStream.current;
      setVideoOn(false);
      savePrefs(false, audioOn);
    }
  }

  async function toggleAudio() {
    if (!ready.current) return;

    if (!audioOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      localStream.current.addTrack(track);
      producers.current.audio = await sendTransport.current.produce({ track });
      setAudioOn(true);
      savePrefs(videoOn, true);
    } else {
      socket.current.emit("closeProducer", {
        producerId: producers.current.audio.id,
      });
      producers.current.audio.close();
      localStream.current.getAudioTracks().forEach((t) => {
        t.stop();
        localStream.current.removeTrack(t);
      });
      setAudioOn(false);
      savePrefs(videoOn, false);
    }
  }

  useEffect(() => {
    if (!roomId) return;
    if (!user?.Room || !user?.Email || !user?.name) {
      navigate("/");
      console.log("not found");
    }
    socket.current = io("http://localhost:3000");

    socket.current.on("connect", () => {
      socket.current.emit("join", { user });
    });

    socket.current.on("routerCapabilities", async (rtp: any) => {
      device.current = new Device();
      await device.current.load({ routerRtpCapabilities: rtp });

      socket.current.emit("createTransport", { type: "send" }, (p: any) => {
        sendTransport.current = device.current.createSendTransport(p);

        sendTransport.current.on(
          "connect",
          ({ dtlsParameters }: any, cb: any) => {
            socket.current.emit(
              "connectTransport",
              { type: "send", dtlsParameters },
              cb,
            );
          },
        );

        sendTransport.current.on(
          "produce",
          ({ kind, rtpParameters }: any, cb: any) => {
            socket.current.emit("produce", { kind, rtpParameters }, cb);
          },
        );

        socket.current.emit("createTransport", { type: "recv" }, (p: any) => {
          recvTransport.current = device.current.createRecvTransport(p);

          recvTransport.current.on(
            "connect",
            ({ dtlsParameters }: any, cb: any) => {
              socket.current.emit(
                "connectTransport",
                { type: "recv", dtlsParameters },
                cb,
              );
            },
          );

          ready.current = true;

          socket.current.on("newProducer", ({ producerId, peerId }: any) => {
            consume(producerId, peerId);
          });

          socket.current.emit("getProducers", (list: any[]) => {
            list.forEach(({ producerId, peerId }) =>
              consume(producerId, peerId),
            );
          });

          const prefs = getPrefs();
          if (prefs.video) toggleVideo();
          if (prefs.audio) toggleAudio();
        });
      });
    });

    socket.current.on("producerClosed", ({ peerId }: any) => {
      setPeers((prev) => {
        const next = { ...prev };
        const stream = next[peerId];
        if (stream && stream.getTracks().length <= 1) {
          delete next[peerId];
        }
        return next;
      });
    });

    socket.current.on("peerLeft", ({ peerId }: any) => {
      setPeers((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    });

    return () => {
      localStream.current.getTracks().forEach((t) => t.stop());
      socket.current?.disconnect();
    };
  }, [roomId]);

  function refreshstream() {
    console.log("refreshed");
    {
      Object.entries(peers).map(([id, stream]) => (
        <PeerVideo key={id} name={id} stream={stream} />
      ));
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 10 }}>
        <button
          onClick={toggleVideo}
          className={`mr-3 px-4 py-2 text-white border-none ${videoOn ? "bg-[green]" : "bg-[#333]"} rounded-md`}
        >
          Video {videoOn ? "On" : "Off"}
        </button>
        <button
          onClick={toggleAudio}
          className={`
            px-4 py-2 text-white border-none ${audioOn ? "bg-[green]" : "bg-[#333]"} rounded-md `}
        >
          Audio {audioOn ? "On" : "Off"}
        </button>
        <button
          onClick={refreshstream}
          className="px-4 py-2 rounded-md bg-[#454] m-5 text-white border-none"
        >
          Refresh
        </button>
      </div>

      <div className=" flex flex-wrap gap-3">
        <div>
          <video
            ref={myVideo}
            autoPlay
            muted
            playsInline
            className="w-[320px] scale-x-[-1] h-[240px] bg-black"
          />
          <p>You</p>
        </div>

        {Object.entries(peers).map(([id, stream]) => (
          <PeerVideo key={id} name={id} stream={stream} />
        ))}
      </div>
    </div>
  );
}

function PeerVideo({ name, stream }: { name: string; stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div>
      <video
        ref={ref}
        autoPlay
        playsInline
        className="w-[320px] scale-x-[-1] h-[240px] bg-black"
      />
      <p>{name}</p>
    </div>
  );
}
