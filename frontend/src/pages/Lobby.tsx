import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { store } from "../lib/store";
import { toast } from "../lib/toastStore";
import { User, Mail, Hash, RefreshCw, ArrowRight, Video } from "lucide-react";

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

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error("Form Error", "Please enter your name.");
      return;
    }
    if (!formData.Room || formData.Room <= 0) {
      toast.error("Form Error", "Please enter a valid room number.");
      return;
    }
    if (!formData.Email.trim()) {
      toast.error("Form Error", "Please enter your email.");
      return;
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
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col justify-center items-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden p-7 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold shadow-sm">
            <Video size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 leading-tight">
              Join Video Room
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Enter your name and room number to join or start a call.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Your Full Name
            </label>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-2.5 text-slate-400" />
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="e.g. Alex Johnson"
                required
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 text-slate-900 font-medium transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-2.5 text-slate-400" />
              <input
                type="email"
                name="Email"
                value={formData.Email}
                onChange={handleChange}
                placeholder="alex@example.com"
                required
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 text-slate-900 font-medium transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Room Number
              </label>
              <button
                type="button"
                onClick={generateRandomRoom}
                className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw size={11} /> Randomize
              </button>
            </div>
            <div className="relative">
              <Hash size={16} className="absolute left-3.5 top-2.5 text-slate-400" />
              <input
                type="number"
                name="Room"
                value={formData.Room === 0 ? "" : formData.Room}
                onChange={handleChange}
                placeholder="101"
                required
                min="1"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 text-slate-900 font-medium transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full mt-3 py-2.5 px-4 bg-slate-900 hover:bg-black active:scale-[0.99] text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <span>Enter Conference Room</span>
            <ArrowRight size={15} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default Lobby;