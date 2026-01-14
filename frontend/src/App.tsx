import { Routes, Route } from "react-router-dom";
import Room from "./pages/Room";
import Lobby from "./pages/Lobby";

function App() {
  return (
      <Routes>
        <Route path="/room/:id" element={<Room />} />
        <Route path="/" element={<Lobby />} />
      </Routes>
  );
}

export default App;