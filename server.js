const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// Ping endpoint
app.get('/ping', (req, res) => {
  res.json({ ts: Date.now() });
});

// ===== Throttled state relay =====
// Chỉ giữ state MỚI NHẤT, gửi theo interval cố định → tránh nghẽn ESP32
let latestState = null;
const RELAY_INTERVAL = 50; // Gửi mỗi 50ms (20Hz) → mượt mà không flood

setInterval(() => {
  if (latestState) {
    io.emit('control:state', latestState);
    latestState = null;
  }
}, RELAY_INTERVAL);

// Socket.IO
io.on('connection', (socket) => {
  console.log(`🎮 Client connected: ${socket.id}`);

  // Gamepad button press/release → relay ngay (ít message)
  socket.on('gamepad:signal', (data) => {
    socket.emit('gamepad:ack', {
      clientTs: data.ts,
      serverTs: Date.now(),
      button: data.button,
      type: data.type
    });

    socket.broadcast.emit('control:gamepad', {
      button: data.button,
      index: data.index,
      type: data.type,
      value: data.value,
      ts: Date.now()
    });
  });

  // Gamepad state (axes + triggers) → CHỈ LƯU MỚI NHẤT
  socket.on('gamepad:state', (data) => {
    socket.emit('gamepad:state:ack', {
      clientTs: data.ts,
      serverTs: Date.now()
    });

    // Ghi đè state cũ, chỉ giữ cái mới nhất
    latestState = {
      axes: data.axes,
      triggers: data.triggers,
      ts: Date.now()
    };
  });

  // Keyboard → relay ngay (ít message)
  socket.on('keyboard:signal', (data) => {
    socket.emit('keyboard:ack', {
      clientTs: data.ts,
      serverTs: Date.now(),
      code: data.code,
      type: data.type
    });

    socket.broadcast.emit('control:key', {
      code: data.code,
      key: data.key,
      type: data.type,
      ts: Date.now()
    });
  });

  socket.on('disconnect', () => {
    console.log(`🎮 Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`🎮 Gamepad Signal Server running at http://localhost:${PORT}`);
});
