/**
 * Keyboard Signal Monitor
 * Listens for keyboard events and sends them to server via Socket.IO.
 * Visual feedback on the keyboard layout + event logging.
 */

(function () {
  'use strict';

  // Reuse shared socket from gamepad.js
  const socket = window.__socket;

  // ========== Tab Switching ==========
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const panel = document.getElementById(`tab-${tabId}`);
      if (panel) panel.classList.add('active');
    });
  });

  // ========== Keyboard Key Elements ==========
  const keyElements = {};
  document.querySelectorAll('.kb-key[data-key]').forEach(el => {
    keyElements[el.dataset.key] = el;
  });

  // ========== Shared Log (reuse from gamepad.js) ==========
  const logPanel = document.getElementById('logPanel');
  const autoScrollCheckbox = document.getElementById('autoScroll');
  let logCount = 0;
  const MAX_LOG_ENTRIES = 500;

  function getTimestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  function addLog(type, keyName) {
    const emptyMsg = logPanel.querySelector('.log-empty');
    if (emptyMsg) emptyMsg.remove();

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = getTimestamp();

    const eventSpan = document.createElement('span');
    eventSpan.className = `log-event ${type}`;
    eventSpan.textContent = type === 'press' ? '▶ KEY↓' : '■ KEY↑';

    const keySpan = document.createElement('span');
    keySpan.className = 'log-button';
    keySpan.textContent = keyName;

    entry.appendChild(timeSpan);
    entry.appendChild(eventSpan);
    entry.appendChild(keySpan);

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

  // ========== Latency Display ==========
  const pingBtn = document.getElementById('pingBtn');
  const pingValue = document.getElementById('pingValue');
  let kbLatencyHistory = [];
  const LATENCY_SIZE = 20;

  function updateLatency(latency) {
    kbLatencyHistory.push(latency);
    if (kbLatencyHistory.length > LATENCY_SIZE) kbLatencyHistory.shift();
    const avg = Math.round(kbLatencyHistory.reduce((a, b) => a + b, 0) / kbLatencyHistory.length);
    pingValue.textContent = `${avg} ms`;
    pingBtn.classList.remove('good', 'medium', 'bad');
    pingBtn.classList.add(avg <= 30 ? 'good' : avg <= 80 ? 'medium' : 'bad');
  }

  // Listen for keyboard signal ack from server
  socket.on('keyboard:ack', (data) => {
    const latency = Date.now() - data.clientTs;
    updateLatency(latency);
  });

  // ========== Keyboard Events ==========
  const pressedKeys = new Set();

  function getKeyLabel(e) {
    // Return a user-friendly label
    if (e.key === ' ') return 'Space';
    if (e.key.length === 1) return e.key.toUpperCase();
    return e.key;
  }

  document.addEventListener('keydown', (e) => {
    // Prevent default for certain keys to avoid page scroll etc.
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }

    const code = e.code;

    // Avoid repeat events
    if (pressedKeys.has(code)) return;
    pressedKeys.add(code);

    // Visual feedback
    const el = keyElements[code];
    if (el) el.classList.add('active');

    // Log
    const label = getKeyLabel(e);
    addLog('press', `${label} (${code})`);

    // Send to server
    socket.emit('keyboard:signal', {
      ts: Date.now(),
      code: code,
      key: e.key,
      type: 'keydown',
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey
    });
  });

  document.addEventListener('keyup', (e) => {
    const code = e.code;
    pressedKeys.delete(code);

    // Visual feedback
    const el = keyElements[code];
    if (el) el.classList.remove('active');

    // Log
    const label = getKeyLabel(e);
    addLog('release', `${label} (${code})`);

    // Send to server
    socket.emit('keyboard:signal', {
      ts: Date.now(),
      code: code,
      key: e.key,
      type: 'keyup',
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey
    });
  });

})();
