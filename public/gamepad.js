/**
 * Gamepad Signal Monitor
 * Uses the Gamepad API to read controller inputs and display them in real-time.
 * Sends gamepad signals to server via Socket.IO and measures round-trip latency.
 */

(function () {
  'use strict';

  // ========== Socket.IO Connection ==========
  const socket = io();
  window.__socket = socket;
  const serverStatus = document.getElementById('serverStatus');
  const serverStatusDot = serverStatus.querySelector('.status-dot');
  const serverStatusText = serverStatus.querySelector('.status-text');

  socket.on('connect', () => {
    serverStatus.classList.add('connected');
    serverStatusText.textContent = 'Server ✓';
    addLog('system', '', `Đã kết nối server (ID: ${socket.id})`);
  });

  socket.on('disconnect', () => {
    serverStatus.classList.remove('connected');
    serverStatusText.textContent = 'Mất kết nối';
    addLog('system', '', 'Mất kết nối server');
  });

  // ========== DOM Elements ==========
  const connectionStatus = document.getElementById('connectionStatus');
  const statusText = connectionStatus.querySelector('.status-text');
  const gamepadInfo = document.getElementById('gamepadInfo');
  const logPanel = document.getElementById('logPanel');
  const clearLogBtn = document.getElementById('clearLog');
  const autoScrollCheckbox = document.getElementById('autoScroll');
  const pingBtn = document.getElementById('pingBtn');
  const pingValue = document.getElementById('pingValue');

  // Button elements mapped to standard gamepad indices
  const buttonElements = {
    0: document.getElementById('btn-cross'),
    1: document.getElementById('btn-circle'),
    2: document.getElementById('btn-square'),
    3: document.getElementById('btn-triangle'),
    4: document.getElementById('btn-L1'),
    5: document.getElementById('btn-R1'),
    6: document.getElementById('btn-L2'),
    7: document.getElementById('btn-R2'),
    10: document.getElementById('btn-L3'),
    11: document.getElementById('btn-R3'),
    12: document.getElementById('btn-dpad-up'),
    13: document.getElementById('btn-dpad-down'),
    14: document.getElementById('btn-dpad-left'),
    15: document.getElementById('btn-dpad-right')
  };

  const buttonNames = {
    0: '× Cross', 1: '○ Circle', 2: '□ Square', 3: '△ Triangle',
    4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2',
    10: 'L3', 11: 'R3',
    12: '↑ D-Up', 13: '↓ D-Down', 14: '← D-Left', 15: '→ D-Right'
  };

  // Joystick elements
  const thumbLeft = document.getElementById('thumb-left');
  const thumbRight = document.getElementById('thumb-right');
  const valLX = document.getElementById('val-lx');
  const valLY = document.getElementById('val-ly');
  const valRX = document.getElementById('val-rx');
  const valRY = document.getElementById('val-ry');
  const valL2 = document.getElementById('val-L2');
  const valR2 = document.getElementById('val-R2');

  // Analog bar elements
  const barLX = document.getElementById('bar-lx');
  const barLY = document.getElementById('bar-ly');
  const barRX = document.getElementById('bar-rx');
  const barRY = document.getElementById('bar-ry');
  const barL2 = document.getElementById('bar-l2');
  const barR2 = document.getElementById('bar-r2');
  const barValLX = document.getElementById('bar-val-lx');
  const barValLY = document.getElementById('bar-val-ly');
  const barValRX = document.getElementById('bar-val-rx');
  const barValRY = document.getElementById('bar-val-ry');
  const barValL2 = document.getElementById('bar-val-l2');
  const barValR2 = document.getElementById('bar-val-r2');

  // ========== State ==========
  let connectedGamepad = null;
  let previousButtonStates = {};
  let logCount = 0;
  const MAX_LOG_ENTRIES = 500;
  const DEADZONE = 0.05;

  // Latency tracking
  let latencyHistory = [];
  const LATENCY_HISTORY_SIZE = 20;
  let lastStateTs = 0;
  const STATE_SEND_INTERVAL = 50; // Send state every 50ms

  // ========== Logging ==========
  function getTimestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  function addLog(type, message, buttonName) {
    const emptyMsg = logPanel.querySelector('.log-empty');
    if (emptyMsg) emptyMsg.remove();

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = getTimestamp();

    const eventSpan = document.createElement('span');
    eventSpan.className = `log-event ${type}`;
    eventSpan.textContent = type === 'press' ? '▶ PRESS' : type === 'release' ? '■ RELEASE' : '● SYSTEM';

    const buttonSpan = document.createElement('span');
    buttonSpan.className = 'log-button';
    buttonSpan.textContent = buttonName || message;

    entry.appendChild(timeSpan);
    entry.appendChild(eventSpan);
    entry.appendChild(buttonSpan);

    logPanel.appendChild(entry);
    logCount++;

    while (logCount > MAX_LOG_ENTRIES) {
      const first = logPanel.querySelector('.log-entry');
      if (first) { first.remove(); logCount--; } else break;
    }

    if (autoScrollCheckbox.checked) {
      logPanel.scrollTop = logPanel.scrollHeight;
    }
  }

  // ========== Latency ==========
  function updateLatencyDisplay(latency) {
    latencyHistory.push(latency);
    if (latencyHistory.length > LATENCY_HISTORY_SIZE) latencyHistory.shift();

    // Average of recent pings
    const avg = Math.round(latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length);

    pingValue.textContent = `${avg} ms`;

    pingBtn.classList.remove('good', 'medium', 'bad');
    const cls = avg <= 30 ? 'good' : avg <= 80 ? 'medium' : 'bad';
    pingBtn.classList.add(cls);
  }

  // Listen for server ack on button signals
  socket.on('gamepad:ack', (data) => {
    const latency = Date.now() - data.clientTs;
    updateLatencyDisplay(latency);
  });

  // Listen for server ack on state updates
  socket.on('gamepad:state:ack', (data) => {
    const latency = Date.now() - data.clientTs;
    updateLatencyDisplay(latency);
  });

  // ========== Analog Helpers ==========
  function applyDeadzone(value) {
    return Math.abs(value) < DEADZONE ? 0 : value;
  }

  function updateJoystickThumb(thumb, x, y) {
    const maxOffset = 50;
    const px = x * maxOffset;
    const py = y * maxOffset;
    thumb.style.transform = `translate(${px}px, ${py}px)`;
    const moving = Math.abs(x) > DEADZONE || Math.abs(y) > DEADZONE;
    thumb.classList.toggle('moving', moving);
  }

  function updateAnalogBar(barEl, valEl, value, isTrigger) {
    const formatted = value.toFixed(2);
    valEl.textContent = formatted;

    if (isTrigger) {
      const pct = Math.max(0, value) * 100;
      barEl.style.left = '0';
      barEl.style.width = `${pct}%`;
    } else {
      const center = 50;
      const halfPct = (value / 2) * 100;
      if (value >= 0) {
        barEl.style.left = `${center}%`;
        barEl.style.width = `${halfPct}%`;
      } else {
        barEl.style.left = `${center + halfPct}%`;
        barEl.style.width = `${-halfPct}%`;
      }
    }
  }

  // ========== Connection Events ==========
  function onGamepadConnected(e) {
    connectedGamepad = e.gamepad;
    previousButtonStates = {};
    connectionStatus.classList.add('connected');
    statusText.textContent = 'Gamepad ✓';
    gamepadInfo.classList.add('hidden');
    addLog('system', '', `Gamepad kết nối: ${connectedGamepad.id}`);
  }

  function onGamepadDisconnected(e) {
    connectedGamepad = null;
    previousButtonStates = {};
    connectionStatus.classList.remove('connected');
    statusText.textContent = 'Gamepad';
    gamepadInfo.classList.remove('hidden');
    addLog('system', '', 'Gamepad đã ngắt kết nối');
    Object.values(buttonElements).forEach(el => {
      if (el) el.classList.remove('active');
    });
    updateJoystickThumb(thumbLeft, 0, 0);
    updateJoystickThumb(thumbRight, 0, 0);
  }

  window.addEventListener('gamepadconnected', onGamepadConnected);
  window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

  // ========== Polling Loop ==========
  function pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) { gp = gamepads[i]; break; }
    }

    if (!gp) {
      requestAnimationFrame(pollGamepad);
      return;
    }

    if (!connectedGamepad) {
      connectedGamepad = gp;
      connectionStatus.classList.add('connected');
      statusText.textContent = 'Gamepad ✓';
      gamepadInfo.classList.add('hidden');
      addLog('system', '', `Gamepad kết nối: ${gp.id}`);
    }

    // ===== Buttons =====
    const trackedButtons = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15];

    for (const idx of trackedButtons) {
      if (idx >= gp.buttons.length) continue;

      const button = gp.buttons[idx];
      const pressed = button.pressed || button.value > 0.5;
      const wasPrevPressed = previousButtonStates[idx] || false;
      const el = buttonElements[idx];
      const name = buttonNames[idx] || `Button ${idx}`;

      if (pressed && !wasPrevPressed) {
        if (el) el.classList.add('active');
        addLog('press', '', name);

        // Send button press signal to server
        socket.emit('gamepad:signal', {
          ts: Date.now(),
          button: name,
          index: idx,
          type: 'press',
          value: button.value
        });
      } else if (!pressed && wasPrevPressed) {
        if (el) el.classList.remove('active');
        addLog('release', '', name);

        // Send button release signal to server
        socket.emit('gamepad:signal', {
          ts: Date.now(),
          button: name,
          index: idx,
          type: 'release',
          value: 0
        });
      }

      previousButtonStates[idx] = pressed;
    }

    // ===== Analog Triggers =====
    if (gp.buttons[6]) {
      const l2Val = gp.buttons[6].value;
      valL2.textContent = l2Val.toFixed(2);
      updateAnalogBar(barL2, barValL2, l2Val, true);
    }
    if (gp.buttons[7]) {
      const r2Val = gp.buttons[7].value;
      valR2.textContent = r2Val.toFixed(2);
      updateAnalogBar(barR2, barValR2, r2Val, true);
    }

    // ===== Analog Sticks =====
    const lx = applyDeadzone(gp.axes[0] || 0);
    const ly = applyDeadzone(gp.axes[1] || 0);
    const rx = applyDeadzone(gp.axes[2] || 0);
    const ry = applyDeadzone(gp.axes[3] || 0);

    updateJoystickThumb(thumbLeft, lx, ly);
    updateJoystickThumb(thumbRight, rx, ry);

    valLX.textContent = lx.toFixed(2);
    valLY.textContent = ly.toFixed(2);
    valRX.textContent = rx.toFixed(2);
    valRY.textContent = ry.toFixed(2);

    updateAnalogBar(barLX, barValLX, lx, false);
    updateAnalogBar(barLY, barValLY, ly, false);
    updateAnalogBar(barRX, barValRX, rx, false);
    updateAnalogBar(barRY, barValRY, ry, false);

    // ===== Send full state to server periodically =====
    const now = Date.now();
    if (now - lastStateTs >= STATE_SEND_INTERVAL) {
      lastStateTs = now;
      socket.emit('gamepad:state', {
        ts: now,
        axes: [lx, ly, rx, ry],
        triggers: [gp.buttons[6]?.value || 0, gp.buttons[7]?.value || 0],
        buttons: trackedButtons.reduce((acc, idx) => {
          if (idx < gp.buttons.length) {
            acc[idx] = { pressed: gp.buttons[idx].pressed, value: gp.buttons[idx].value };
          }
          return acc;
        }, {})
      });
    }

    requestAnimationFrame(pollGamepad);
  }

  // ========== Manual Ping ==========
  pingBtn.addEventListener('click', () => {
    const start = Date.now();
    socket.emit('gamepad:signal', { ts: start, button: 'PING', type: 'ping', index: -1, value: 0 });
    addLog('system', '', 'Đo latency tín hiệu...');
  });

  // ========== Clear Log ==========
  clearLogBtn.addEventListener('click', () => {
    logPanel.innerHTML = '<div class="log-empty">Log đã được xóa.</div>';
    logCount = 0;
  });

  // ========== Start ==========
  addLog('system', '', 'Hệ thống sẵn sàng - chờ kết nối gamepad...');

  if ('getGamepads' in navigator) {
    addLog('system', '', 'Gamepad API được hỗ trợ ✓');
    requestAnimationFrame(pollGamepad);
  } else {
    addLog('system', '', '⚠ Trình duyệt không hỗ trợ Gamepad API');
    statusText.textContent = 'Không hỗ trợ';
  }
})();
