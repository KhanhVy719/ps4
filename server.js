const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// Ping endpoint for latency test
app.get('/ping', (req, res) => {
  res.json({ ts: Date.now() });
});

app.listen(PORT, () => {
  console.log(`🎮 Gamepad Signal Server running at http://localhost:${PORT}`);
});
