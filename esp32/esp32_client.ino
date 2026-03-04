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
 * Thư viện cần cài:
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
const char* WIFI_SSID      = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD   = "YOUR_WIFI_PASSWORD";

const char* SERVER_HOST     = "ps4-production.up.railway.app";
const uint16_t SERVER_PORT  = 8080;
const bool USE_SSL          = true;

// Servo
#define SERVO_PIN 33
#define SERVO_STOP    1500   // Microseconds - dừng
#define SERVO_FORWARD 2000   // Microseconds - tiến (max)
#define SERVO_REVERSE 1000   // Microseconds - lùi (max)

// ==================== BIẾN ====================
SocketIOclient socketIO;
Servo servo;
bool isConnected = false;

// Trạng thái phím
volatile bool keyW = false;  // Tiến
volatile bool keyS = false;  // Lùi

// Latency
unsigned long lastServoUpdate = 0;
const unsigned long SERVO_UPDATE_INTERVAL = 10; // Cập nhật servo mỗi 10ms (100Hz)

// ==================== XỬ LÝ SOCKET.IO ====================
void socketIOEvent(socketIOmessageType_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      Serial.println("[IO] Disconnected!");
      isConnected = false;
      // An toàn: dừng servo khi mất kết nối
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

    default:
      break;
  }
}

void handleEvent(uint8_t* payload, size_t length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) return;

  const char* event = doc[0];

  // Nhận tín hiệu bàn phím từ server
  if (strcmp(event, "keyboard:signal") == 0 || 
      strcmp(event, "keyboard:ack") == 0) {
    // Nếu server relay lại tín hiệu keyboard
    // Không cần xử lý ở đây vì ta lắng nghe sự kiện riêng
  }

  // ===== Lắng nghe tín hiệu điều khiển =====
  // Server cần broadcast/relay keyboard events tới ESP32
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
      
      // Cập nhật servo NGAY LẬP TỨC để latency thấp nhất
      updateServo();
    }
  }
}

// ==================== ĐIỀU KHIỂN SERVO ====================
void updateServo() {
  int pwm = SERVO_STOP;
  
  if (keyW && !keyS) {
    pwm = SERVO_FORWARD;  // Tiến
  } else if (keyS && !keyW) {
    pwm = SERVO_REVERSE;  // Lùi
  }
  // Cả 2 bấm hoặc không bấm → dừng
  
  servo.writeMicroseconds(pwm);
}

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ESP32 Servo Controller ===");

  // Servo
  servo.attach(SERVO_PIN, SERVO_REVERSE, SERVO_FORWARD);
  servo.writeMicroseconds(SERVO_STOP);
  Serial.printf("Servo on GPIO%d\n", SERVO_PIN);

  // WiFi - tối ưu tốc độ
  WiFi.setSleep(false);  // Tắt WiFi sleep → latency thấp hơn
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("WiFi: %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

  // Socket.IO
  if (USE_SSL) {
    socketIO.beginSSL(SERVER_HOST, SERVER_PORT, "/socket.io/?EIO=4");
  } else {
    socketIO.begin(SERVER_HOST, SERVER_PORT, "/socket.io/?EIO=4");
  }
  socketIO.onEvent(socketIOEvent);
  // Tối ưu: reconnect nhanh
  socketIO.setReconnectInterval(1000);

  Serial.printf("Server: %s:%d (SSL:%d)\n", SERVER_HOST, SERVER_PORT, USE_SSL);
}

// ==================== LOOP ====================
void loop() {
  socketIO.loop();

  // Cập nhật servo định kỳ (safety fallback)
  unsigned long now = millis();
  if (now - lastServoUpdate >= SERVO_UPDATE_INTERVAL) {
    lastServoUpdate = now;
    updateServo();
  }
}
