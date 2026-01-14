// src/pages/Lobby.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { store } from "../lib/store";

interface FormDetail {
  name: string;
  Room: number;
  Email: string;
}

const Lobby: React.FC = () => {
  const setUser = store((state) => state.setUser);
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState<FormDetail>({
    name: "",
    Room: 0,
    Email: "",
  });

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    if (!formData.name || !formData.Room || !formData.Email) {
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

  return (
    <div className="bg-gradient-to-tl h-screen w-screen from-[#02fcbe] to-[#9bf990]">
      <div className="w-full h-full flex justify-center items-center flex-col">
        <h1 className="font-extrabold text-3xl sm:text-5xl pb-5">
          Welcome to Lobby 😀
        </h1>
        <form
          onSubmit={handleSubmit}
          className="bg-gradient-to-br pb-5 px-5 rounded-md from-[#76e340] to-[#aff019] shadow-sm shadow-gray-400 space-y-4 w-96 flex flex-col items-center justify-center"
        >
          <h1 className="font-semibold sm:text-xl text-lg pt-3 pb-5">
            Enter room details:
          </h1>
          
          <label className="text-lg flex sm:text-xl text-gray-800 font-medium w-full">
            Name:
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Your Name"
              required
              className="px-2 mx-2 focus:outline-none placeholder:px-1 font-semibold capitalize text-gray-500 flex-1 py-1 rounded-md text-lg"
            />
          </label>
          
          <label className="text-lg sm:text-xl flex items-center text-gray-800 font-medium w-full">
            Room:
            <input
              type="number"
              name="Room"
              value={formData.Room === 0 ? "" : formData.Room}
              onChange={handleChange}
              placeholder="Room no."
              required
              min="1"
              onWheel={(e) => e.currentTarget.blur()}
              className="px-2 focus:outline-none placeholder:px-1 font-semibold text-gray-500 mx-2 flex-1 py-1 rounded-md text-lg"
            />
          </label>
          
          <label className="text-lg sm:text-xl flex items-center text-gray-800 font-medium w-full">
            Email:
            <input
              type="email"
              name="Email"
              value={formData.Email}
              onChange={handleChange}
              placeholder="your@email.com"
              required
              className="px-2 focus:outline-none placeholder:px-1 font-semibold text-gray-500 mx-2 flex-1 py-1 rounded-md text-lg"
            />
          </label>
          
          <button
            type="submit"
            className="px-4 py-2 bg-[#4e92f1] text-lg font-semibold rounded-md hover:bg-[#3d7fd9] transition-colors"
          >
            Join Room
          </button>
        </form>
      </div>
    </div>
  );
};

export default Lobby;