/**
 * ESP32 Servo Controller via WebSocket
 * 
 * Joystick trái X → Servo SG90 lái (GPIO33)
 * Keyboard A/D → Servo lái (fallback)
 * 
 * Sơ đồ nối dây:
 *   [Pin 5V]──(+)──── Đỏ (VCC) ──────── Servo
 *           └─(-)──┬─ Nâu/Đen (GND) ─── Servo
 *                  └─ GND ────────────── ESP32 GND  ⚠ CHUNG GND
 *   ESP32 GPIO33 ──── Cam/Vàng (Signal)─ Servo
 * 
 * Thư viện:
 *   links2004/WebSockets @ ^2.4.1
 *   bblanchon/ArduinoJson @ ^7.0.0
 *   madhephaestus/ESP32Servo @ ^3.0.0
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>
#include <SocketIOclient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ==================== CẤU HÌNH ====================
const char* WIFI_SSID      = "VIETTEL_XUAN KHANH";
const char* WIFI_PASSWORD   = "05052023";

const char* SERVER_HOST     = "ps4-production.up.railway.app";
const uint16_t SERVER_PORT  = 443;

// Servo SG90 trên GPIO33
#define SERVO_PIN    33
#define SERVO_MIN    500   // 0°
#define SERVO_CENTER 1450  // ~90°
#define SERVO_MAX    2400  // 180°

// ==================== BIẾN ====================
SocketIOclient socketIO;
Servo servo;
bool isConnected = false;

float steerX = 0.0;  // -1.0 (trái) → 1.0 (phải)
bool keyA = false, keyD = false;

unsigned long lastUpdate = 0;

// ==================== SOCKET.IO ====================
void socketIOEvent(socketIOmessageType_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      Serial.println("[IO] Disconnected!");
      isConnected = false;
      servo.writeMicroseconds(SERVO_CENTER);
      break;
    case sIOtype_CONNECT:
      Serial.printf("[IO] Connected: %s\n", payload);
      isConnected = true;
      socketIO.send(sIOtype_CONNECT, "/");
      break;
    case sIOtype_EVENT:
      handleEvent(payload, length);
      break;
    default: break;
  }
}

void handleEvent(uint8_t* payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  const char* event = doc[0];
  if (!event) return;

  // Joystick state (liên tục)
  if (strcmp(event, "control:state") == 0) {
    if (doc[1].containsKey("axes")) {
      steerX = doc[1]["axes"][0] | 0.0f;
    }
    applyServo();
    return;
  }

  // Keyboard A/D fallback
  if (strcmp(event, "control:key") == 0) {
    const char* code = doc[1]["code"];
    const char* type = doc[1]["type"];
    if (!code || !type) return;
    bool down = (strcmp(type, "keydown") == 0);
    if (strcmp(code, "KeyA") == 0) keyA = down;
    else if (strcmp(code, "KeyD") == 0) keyD = down;
    Serial.printf("[KB] %s %s\n", type, code);
    applyServo();
  }
}

// ==================== SERVO ====================
void applyServo() {
  float steer = steerX;
  if (steer == 0.0 && (keyA || keyD)) {
    steer = keyA ? -1.0 : 1.0;
  }

  int pwm = SERVO_CENTER + (int)(steer * 950);
  pwm = constrain(pwm, SERVO_MIN, SERVO_MAX);
  servo.writeMicroseconds(pwm);
}

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== ESP32 Servo (SG90) ===");

  servo.attach(SERVO_PIN, SERVO_MIN, SERVO_MAX);
  servo.writeMicroseconds(SERVO_CENTER);
  Serial.printf("Servo GPIO%d\n", SERVO_PIN);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("WiFi: %s", WIFI_SSID);
  int r = 0;
  while (WiFi.status() != WL_CONNECTED && r < 40) { delay(500); Serial.print("."); r++; }
  if (WiFi.status() != WL_CONNECTED) { Serial.println("\nWiFi FAIL!"); ESP.restart(); }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

  socketIO.beginSSL(SERVER_HOST, SERVER_PORT, "/socket.io/?EIO=4&transport=websocket");
  socketIO.onEvent(socketIOEvent);
  socketIO.setReconnectInterval(2000);
  Serial.printf("wss://%s:%d\n", SERVER_HOST, SERVER_PORT);
}

// ==================== LOOP ====================
void loop() {
  socketIO.loop();
  unsigned long now = millis();
  if (now - lastUpdate >= 10) {
    lastUpdate = now;
    applyServo();
  }
}
