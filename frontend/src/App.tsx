import { Routes, Route } from "react-router-dom";
import Room from "./pages/Room";
import Lobby from "./pages/Lobby";
import { ToastContainer } from "./components/ToastContainer";

function App() {
  return (
    <>
      <ToastContainer />
      <Routes>
        <Route path="/room/:id" element={<Room />} />
        <Route path="/" element={<Lobby />} />
      </Routes>
    </>
  );
}

export default App;