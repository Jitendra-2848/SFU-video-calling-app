// src/pages/Lobby.tsx
import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { store } from "../lib/store";
import { Video, VideoOff, Mic, User, Mail, Hash, Sparkles, ArrowRight } from "lucide-react";

interface FormDetail {
  name: string;
  Room: number;
  Email: string;
}

const Lobby: React.FC = () => {
  const setUser = store((state) => state.setUser);
  const storedUser = store((state) => state.user);
  const navigate = useNavigate();

  const [formData, setFormData] = useState<FormDetail>({
    name: storedUser?.name || "",
    Room: storedUser?.Room || 101,
    Email: storedUser?.Email || "",
  });

  const [camPreview, setCamPreview] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Toggle pre-flight camera check
  const togglePreview = async () => {
    if (camPreview) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setCamPreview(false);
    } else {
      try {
        setErrorMessage("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360 },
          audio: true,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCamPreview(true);
        setMicActive(stream.getAudioTracks().length > 0);
      } catch (err: any) {
        setErrorMessage("Camera/Microphone access: " + err.message);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!formData.name.trim()) {
      setErrorMessage("Please enter your name.");
      return;
    }
    if (!formData.Room || formData.Room <= 0) {
      setErrorMessage("Please enter a valid room number.");
      return;
    }
    if (!formData.Email.trim()) {
      setErrorMessage("Please enter your email.");
      return;
    }

    // Stop lobby preview stream before moving to the room
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    setUser(formData);
    navigate(`/room/${formData.Room}`);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "Room" ? Number(value) : value,
    }));
  };

  const generateRandomRoom = () => {
    const randomRoom = Math.floor(100 + Math.random() * 900);
    setFormData((prev) => ({ ...prev, Room: randomRoom }));
  };

  return (
    <div className="min-h-screen w-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-2">
        {/* Left: Interactive Media Preview & Brand Info */}
        <div className="bg-slate-900 p-8 flex flex-col justify-between text-white relative">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white font-bold text-sm">
                SFU
              </div>
              <span className="font-bold text-lg tracking-tight text-white">
                WebRTC Studio
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Low-latency Selective Forwarding Unit (SFU) multi-party video conferencing.
            </p>
          </div>

          {/* Camera Preview Box */}
          <div className="my-6">
            <div className="w-full aspect-video bg-slate-800 rounded-xl overflow-hidden border border-slate-700 relative flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={`w-full h-full object-cover scale-x-[-1] ${camPreview ? "block" : "hidden"}`}
              />
              {!camPreview && (
                <div className="text-center p-4 text-slate-400">
                  <div className="w-12 h-12 rounded-full bg-slate-700/80 mx-auto flex items-center justify-center mb-2 text-slate-300">
                    <VideoOff size={22} />
                  </div>
                  <p className="text-xs font-medium">Camera preview is off</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Click below to test your webcam
                  </p>
                </div>
              )}

              {/* Status Pills */}
              {camPreview && (
                <div className="absolute top-2.5 left-2.5 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Camera Active
                </div>
              )}
            </div>

            {/* Test Hardware Button */}
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={togglePreview}
                className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                {camPreview ? <VideoOff size={14} /> : <Video size={14} />}
                <span>{camPreview ? "Turn Off Preview" : "Test Camera & Mic"}</span>
              </button>

              {micActive && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <Mic size={13} /> Mic Ready
                </span>
              )}
            </div>
          </div>

          <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-3">
            Powered by Mediasoup multi-worker architecture on Node.js.
          </div>
        </div>

        {/* Right: Clean Entry Form */}
        <div className="p-8 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-800">
              Join Video Room
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Enter your details and room number to join or create a conference call.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name input */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Your Full Name
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. Alex Johnson"
                  required
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 placeholder-slate-400 transition-all"
                />
              </div>
            </div>

            {/* Email input */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  name="Email"
                  value={formData.Email}
                  onChange={handleChange}
                  placeholder="alex@example.com"
                  required
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 placeholder-slate-400 transition-all"
                />
              </div>
            </div>

            {/* Room Number input with Randomize button */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Room Number
                </label>
                <button
                  type="button"
                  onClick={generateRandomRoom}
                  className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                >
                  <Sparkles size={12} /> Randomize
                </button>
              </div>
              <div className="relative">
                <Hash size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="number"
                  name="Room"
                  value={formData.Room === 0 ? "" : formData.Room}
                  onChange={handleChange}
                  placeholder="e.g. 101"
                  required
                  min="1"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 placeholder-slate-400 transition-all"
                />
              </div>
            </div>

            {/* Error Message if any */}
            {errorMessage && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-xs font-medium">
                {errorMessage}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-all"
            >
              <span>Enter Conference Room</span>
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Lobby;