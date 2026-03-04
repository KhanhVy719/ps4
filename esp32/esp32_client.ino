/**
 * ESP32 RC Controller via WebSocket
 * 
 * Điều khiển:
 *   - Gamepad R2 = tiến (motor), L2 = lùi (motor)
 *   - Gamepad Joystick trái X = servo lái (trái/phải)
 *   - Keyboard W/S = tiến/lùi (fallback), A/D = lái trái/phải
 * 
 * Sơ đồ nối dây:
 * 
 *   [Pin 5V]──(+)──── Đỏ (VCC) ──────── Servo + Motor/ESC
 *           └─(-)──┬─ Nâu/Đen (GND) ─── Servo + Motor/ESC
 *                  └─ GND ────────────── ESP32 GND  ⚠ CHUNG GND
 * 
 *   ESP32 GPIO33 ──── Servo Signal (lái)
 *   ESP32 GPIO32 ──── Motor/ESC Signal (ga)
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

// Pins
#define SERVO_PIN  33   // Servo lái (joystick)
#define MOTOR_PIN  32   // Motor/ESC (R2/L2)

// Servo lái (SG90: 0°-180°, PWM 500-2400μs)
#define STEER_CENTER  1450  // ~90° thẳng
#define STEER_LEFT     500  // 0° hết trái
#define STEER_RIGHT   2400  // 180° hết phải

// Motor/ESC (SG90: 500-2400μs)
#define MOTOR_STOP    1450
#define MOTOR_FULL_FWD 2400  // W / R2 = tiến
#define MOTOR_FULL_REV  500  // S / L2 = lùi

// ==================== BIẾN ====================
SocketIOclient socketIO;
Servo servoSteer;   // Servo lái
Servo servoMotor;   // Motor/ESC
bool isConnected = false;

// Giá trị điều khiển (cập nhật liên tục)
float steerX = 0.0;     // Joystick X: -1.0 (trái) → 1.0 (phải)
float throttleR2 = 0.0;  // R2 trigger: 0.0 → 1.0 (tiến)
float throttleL2 = 0.0;  // L2 trigger: 0.0 → 1.0 (lùi)

// Keyboard fallback
bool keyW = false, keyS = false, keyA = false, keyD = false;

// Timing
unsigned long lastUpdate = 0;
const unsigned long UPDATE_INTERVAL = 10; // 100Hz

// ==================== SOCKET.IO ====================
void socketIOEvent(socketIOmessageType_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      Serial.println("[IO] Disconnected!");
      isConnected = false;
      emergencyStop();
      break;

    case sIOtype_CONNECT:
      Serial.printf("[IO] Connected: %s\n", payload);
      isConnected = true;
      socketIO.send(sIOtype_CONNECT, "/");
      break;

    case sIOtype_EVENT:
      handleEvent(payload, length);
      break;

    case sIOtype_ERROR:
      Serial.printf("[IO] ERROR: %s\n", payload);
      break;

    default: break;
  }
}

void handleEvent(uint8_t* payload, size_t length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) return;

  const char* event = doc[0];
  if (!event) return;

  // ===== Gamepad state: joystick + triggers (liên tục) =====
  if (strcmp(event, "control:state") == 0) {
    // axes[0] = Left X (lái), axes[1] = Left Y
    if (doc[1].containsKey("axes")) {
      steerX = doc[1]["axes"][0] | 0.0f;
    }
    // triggers[0] = L2, triggers[1] = R2
    if (doc[1].containsKey("triggers")) {
      throttleL2 = doc[1]["triggers"][0] | 0.0f;
      throttleR2 = doc[1]["triggers"][1] | 0.0f;
    }
    
    applyControls();
    return;
  }

  // ===== Keyboard fallback =====
  if (strcmp(event, "control:key") == 0) {
    const char* code = doc[1]["code"];
    const char* type = doc[1]["type"];
    if (!code || !type) return;

    bool down = (strcmp(type, "keydown") == 0);

    if (strcmp(code, "KeyW") == 0) keyW = down;
    else if (strcmp(code, "KeyS") == 0) keyS = down;
    else if (strcmp(code, "KeyA") == 0) keyA = down;
    else if (strcmp(code, "KeyD") == 0) keyD = down;

    Serial.printf("[KB] %s %s → W:%d S:%d A:%d D:%d\n", type, code, keyW, keyS, keyA, keyD);
    applyControls();
    return;
  }
}

// ==================== ĐIỀU KHIỂN ====================
void applyControls() {
  // === SERVO LÁI (joystick X hoặc A/D) ===
  float steer = steerX;
  if (steer == 0.0 && (keyA || keyD)) {
    steer = keyA ? -1.0 : (keyD ? 1.0 : 0.0);
  }
  int steerPWM = STEER_CENTER + (int)(steer * 950); // 500-2400
  steerPWM = constrain(steerPWM, STEER_LEFT, STEER_RIGHT);
  servoSteer.writeMicroseconds(steerPWM);

  // === MOTOR/ESC (R2/L2 hoặc W/S) ===
  float throttle = 0.0;
  if (throttleR2 > 0.05) {
    throttle = throttleR2;       // R2 = tiến
  } else if (throttleL2 > 0.05) {
    throttle = -throttleL2;      // L2 = lùi
  } else if (keyW) {
    throttle = 1.0;              // W = tiến max
  } else if (keyS) {
    throttle = -1.0;             // S = lùi max
  }

  int motorPWM = MOTOR_STOP + (int)(throttle * 950); // 500-2400
  motorPWM = constrain(motorPWM, MOTOR_FULL_REV, MOTOR_FULL_FWD);
  servoMotor.writeMicroseconds(motorPWM);
}

void emergencyStop() {
  steerX = 0; throttleR2 = 0; throttleL2 = 0;
  keyW = keyS = keyA = keyD = false;
  servoSteer.writeMicroseconds(STEER_CENTER);
  servoMotor.writeMicroseconds(MOTOR_STOP);
  Serial.println("[SAFE] Emergency stop!");
}

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== ESP32 RC Controller ===");

  // Servo + Motor
  servoSteer.attach(SERVO_PIN, STEER_LEFT, STEER_RIGHT);
  servoMotor.attach(MOTOR_PIN, MOTOR_FULL_REV, MOTOR_FULL_FWD);
  servoSteer.writeMicroseconds(STEER_CENTER);
  servoMotor.writeMicroseconds(MOTOR_STOP);
  Serial.printf("Servo (lai): GPIO%d | Motor: GPIO%d\n", SERVO_PIN, MOTOR_PIN);

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("WiFi: %s", WIFI_SSID);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 40) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nWiFi FAILED! Restart...");
    ESP.restart();
  }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

  // Socket.IO SSL
  socketIO.beginSSL(SERVER_HOST, SERVER_PORT, "/socket.io/?EIO=4&transport=websocket");
  socketIO.onEvent(socketIOEvent);
  socketIO.setReconnectInterval(2000);
  Serial.printf("Server: wss://%s:%d\n", SERVER_HOST, SERVER_PORT);
}

// ==================== LOOP ====================
void loop() {
  socketIO.loop();

  unsigned long now = millis();
  if (now - lastUpdate >= UPDATE_INTERVAL) {
    lastUpdate = now;
    applyControls();
  }
}
