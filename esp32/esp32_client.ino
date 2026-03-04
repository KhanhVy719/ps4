/**
 * ESP32 Servo Controller via WebSocket
 * 
 * Servo wiring:
 *   Nâu/Đen (GND)     → GND ESP32 (+ GND nguồn ngoài)
 *   Đỏ (+5V)           → Nguồn 5V ngoài
 *   Cam/Vàng (Signal)  → GPIO33
 *   ⚠ NỐI CHUNG GND nguồn ngoài với GND ESP32
 * 
 * Điều khiển: W = tiến, S = lùi (nhận từ server qua WebSocket)
 * 
 * Thư viện cần cài (PlatformIO lib_deps):
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

// Servo
#define SERVO_PIN 33
#define SERVO_STOP    1500
#define SERVO_FORWARD 2000
#define SERVO_REVERSE 1000

// ==================== BIẾN ====================
SocketIOclient socketIO;
Servo servo;
bool isConnected = false;

// Trạng thái phím
volatile bool keyW = false;
volatile bool keyS = false;

// Timing
unsigned long lastServoUpdate = 0;
const unsigned long SERVO_UPDATE_INTERVAL = 10; // 100Hz

// ==================== XỬ LÝ SOCKET.IO ====================
void socketIOEvent(socketIOmessageType_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      Serial.println("[IO] Disconnected!");
      isConnected = false;
      servo.writeMicroseconds(SERVO_STOP);
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
      Serial.printf("[IO] ERROR: %u %s\n", length, payload);
      break;

    default:
      break;
  }
}

void handleEvent(uint8_t* payload, size_t length) {
  Serial.printf("[IO] Event raw: %s\n", payload);

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[IO] JSON error: %s\n", err.c_str());
    return;
  }

  const char* event = doc[0];
  if (!event) return;

  Serial.printf("[IO] Event: %s\n", event);

  // Nhận tín hiệu điều khiển từ server
  if (strcmp(event, "control:key") == 0) {
    const char* code = doc[1]["code"];
    const char* type = doc[1]["type"];
    
    if (code && type) {
      if (strcmp(code, "KeyW") == 0) {
        keyW = (strcmp(type, "keydown") == 0);
      } else if (strcmp(code, "KeyS") == 0) {
        keyS = (strcmp(type, "keydown") == 0);
      }
      
      Serial.printf("[RX] %s %s → W:%d S:%d\n", type, code, keyW, keyS);
      updateServo(); // Cập nhật ngay
    }
  }
}

// ==================== ĐIỀU KHIỂN SERVO ====================
int currentPWM = SERVO_STOP;

void updateServo() {
  int targetPWM = SERVO_STOP;
  
  if (keyW && !keyS) {
    targetPWM = SERVO_FORWARD;
  } else if (keyS && !keyW) {
    targetPWM = SERVO_REVERSE;
  }
  
  servo.writeMicroseconds(targetPWM);
  
  if (targetPWM != currentPWM) {
    const char* state = targetPWM == SERVO_FORWARD ? "FORWARD" : 
                        targetPWM == SERVO_REVERSE ? "REVERSE" : "STOP";
    Serial.printf("[SERVO] %s (PWM: %d)\n", state, targetPWM);
    currentPWM = targetPWM;
  }
}

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== ESP32 Servo Controller ===");

  // Servo
  servo.attach(SERVO_PIN, SERVO_REVERSE, SERVO_FORWARD);
  servo.writeMicroseconds(SERVO_STOP);
  Serial.printf("Servo on GPIO%d\n", SERVO_PIN);

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
    Serial.println("\nWiFi FAILED! Restarting...");
    ESP.restart();
  }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

  // Socket.IO over SSL (Railway HTTPS)
  socketIO.beginSSL(SERVER_HOST, SERVER_PORT, "/socket.io/?EIO=4&transport=websocket");
  socketIO.onEvent(socketIOEvent);
  socketIO.setReconnectInterval(2000);

  Serial.printf("Connecting to: wss://%s:%d\n", SERVER_HOST, SERVER_PORT);
}

// ==================== LOOP ====================
void loop() {
  socketIO.loop();

  unsigned long now = millis();
  if (now - lastServoUpdate >= SERVO_UPDATE_INTERVAL) {
    lastServoUpdate = now;
    updateServo();
  }
}
