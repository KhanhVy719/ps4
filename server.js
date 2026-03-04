const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
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

  // Client sends gamepad signal → server echoes back with timestamp for latency measurement
  socket.on('gamepad:signal', (data) => {
    // Echo back to client with server timestamp
    socket.emit('gamepad:ack', {
      clientTs: data.ts,
      serverTs: Date.now(),
      button: data.button,
      type: data.type
    });
  });

  // Gamepad state update (all buttons/axes)
  socket.on('gamepad:state', (data) => {
    // Echo back for latency measurement
    socket.emit('gamepad:state:ack', {
      clientTs: data.ts,
      serverTs: Date.now()
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
