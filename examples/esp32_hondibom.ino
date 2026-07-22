/*
  혼디봄 ESP32 텔레메트리 예제
  보드: Espressif ESP32-DevKitC V4
  센서: HLK-LD2410C OUT, AMS39NO 도어 센서, SHT31, 안부 버튼, SOS 버튼

  Arduino Library Manager에서 Adafruit SHT31 Library를 설치하세요.
  SERVER_URL은 로컬 PC IP 또는 Render 주소로 변경해야 합니다.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* DEVICE_ID = "HB-ESP32-01";
const char* SERVER_URL = "http://192.168.0.10:3000";
const char* DEVICE_API_KEY = "";  // 서버에서 DEVICE_API_KEY를 설정한 경우 같은 값을 입력

constexpr int PIN_LD2410_OUT = 27;
constexpr int PIN_DOOR = 26;
constexpr int PIN_CHECKIN = 25;
constexpr int PIN_SOS = 33;
constexpr unsigned long SEND_INTERVAL_MS = 30000;
constexpr unsigned long SOS_HOLD_MS = 3000;

Adafruit_SHT31 sht31 = Adafruit_SHT31();
unsigned long lastSentAt = 0;
unsigned long sosPressedAt = 0;
bool previousDoorOpen = false;
bool previousCheckin = false;

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Wi-Fi connecting");
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(350);
    Serial.print('.');
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " failed");
}

bool readSosLongPress() {
  const bool pressed = digitalRead(PIN_SOS) == LOW;
  if (!pressed) {
    sosPressedAt = 0;
    return false;
  }
  if (sosPressedAt == 0) sosPressedAt = millis();
  return millis() - sosPressedAt >= SOS_HOLD_MS;
}

bool postTelemetry(bool doorOpened, bool checkinPressed, bool sosPressed) {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return false;

  const bool presenceDetected = digitalRead(PIN_LD2410_OUT) == HIGH;
  const float temperatureC = sht31.readTemperature();
  const float humidity = sht31.readHumidity();
  if (isnan(temperatureC) || isnan(humidity)) {
    Serial.println("SHT31 read failed");
    return false;
  }

  String body = "{";
  body += "\"presenceDetected\":" + String(presenceDetected ? "true" : "false") + ",";
  body += "\"doorOpened\":" + String(doorOpened ? "true" : "false") + ",";
  body += "\"checkinPressed\":" + String(checkinPressed ? "true" : "false") + ",";
  body += "\"sosPressed\":" + String(sosPressed ? "true" : "false") + ",";
  body += "\"temperatureC\":" + String(temperatureC, 1) + ",";
  body += "\"humidity\":" + String(humidity, 0);
  body += "}";

  HTTPClient http;
  const String endpoint = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/telemetry";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_API_KEY) > 0) http.addHeader("X-Device-Key", DEVICE_API_KEY);
  const int status = http.POST(body);
  Serial.printf("POST %s -> %d\n", endpoint.c_str(), status);
  if (status > 0) Serial.println(http.getString());
  http.end();
  return status >= 200 && status < 300;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LD2410_OUT, INPUT);
  pinMode(PIN_DOOR, INPUT_PULLUP);
  pinMode(PIN_CHECKIN, INPUT_PULLUP);
  pinMode(PIN_SOS, INPUT_PULLUP);
  Wire.begin(21, 22);
  if (!sht31.begin(0x44)) Serial.println("SHT31 not found at 0x44");
  connectWiFi();
}

void loop() {
  const bool doorOpen = digitalRead(PIN_DOOR) == HIGH;
  const bool checkin = digitalRead(PIN_CHECKIN) == LOW;
  const bool doorEvent = doorOpen && !previousDoorOpen;
  const bool checkinEvent = checkin && !previousCheckin;
  const bool sosEvent = readSosLongPress();
  const bool periodic = millis() - lastSentAt >= SEND_INTERVAL_MS;

  if (doorEvent || checkinEvent || sosEvent || periodic) {
    if (postTelemetry(doorEvent, checkinEvent, sosEvent)) lastSentAt = millis();
    if (sosEvent) sosPressedAt = millis();
  }

  previousDoorOpen = doorOpen;
  previousCheckin = checkin;
  delay(40);
}
