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

// Ping endpoint for latency test
app.get('/ping', (req, res) => {
  res.json({ ts: Date.now() });
});

// Socket.IO - Gamepad signal relay
io.on('connection', (socket) => {
  console.log(`🎮 Client connected: ${socket.id}`);

  // Client sends gamepad signal → echo back + relay to ESP32
  socket.on('gamepad:signal', (data) => {
    socket.emit('gamepad:ack', {
      clientTs: data.ts,
      serverTs: Date.now(),
      button: data.button,
      type: data.type
    });

    // Relay button press/release to ESP32
    socket.broadcast.emit('control:gamepad', {
      button: data.button,
      index: data.index,
      type: data.type,
      value: data.value,
      ts: Date.now()
    });
  });

  // Gamepad state update (axes + triggers) → relay to ESP32
  socket.on('gamepad:state', (data) => {
    socket.emit('gamepad:state:ack', {
      clientTs: data.ts,
      serverTs: Date.now()
    });

    // Relay full state to ESP32 (joystick + triggers)
    socket.broadcast.emit('control:state', {
      axes: data.axes,
      triggers: data.triggers,
      ts: Date.now()
    });
  });

  // Keyboard signal → echo back + broadcast to ESP32
  socket.on('keyboard:signal', (data) => {
    // Echo back for latency measurement
    socket.emit('keyboard:ack', {
      clientTs: data.ts,
      serverTs: Date.now(),
      code: data.code,
      type: data.type
    });

    // Relay to ALL other clients (ESP32) as control command
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
