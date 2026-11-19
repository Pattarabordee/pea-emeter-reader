// Radio head for the drive-by reader: a BLE central that passes bytes between one meter and the host.
// It knows no DLMS and stores nothing (the meter password only ever passes through inside TX bytes).
//
// Host link: USB serial, one text line per message, '\n' terminated. <us> = microseconds since the CONN line arrived.
//   host -> radio                          radio -> host
//   VER                                    OK VER <text>
//   SCAN <ms> [A]   (A = active scan)      ADV <mac> <addrType> <rssi> <micros> <name>   (every advert, duplicates included)
//                                          SCANEND
//   STOP                                   OK STOP
//   CONN <mac> <addrType> <itvl> <toMs>    EVT CONNECTED <us> / EVT MTU <us> <mtu> / EVT DISCOVERED <us> <wrHandle> <ntHandle>
//        itvl in 1.25 ms units (6 = 7.5)   EVT READY <us> <mtu> <itvl> <writeNoRsp 0|1>     or  ERR CONN <why>
//   TX <hex>                               OK TX            or  ERR TX <why>
//                                          RX <hex>         (each notification as it arrives)
//   INFO                                   OK INFO <mtu> <itvl> <rssi>
//   ITVL <itvl>                            OK ITVL          (ask the meter for a new interval; check with INFO)
//   PHY <mask>      (1 = 1M, 2 = 2M)       OK PHY, then EVT PHY <us> <tx> <rx> if the meter agrees
//   PWR <dBm>                              OK PWR           (check the e.i.r.p. limit before raising it)
//   ANT <0|1>       (XIAO C6: 1 = u.FL)    OK ANT
//   PACE <chunk> <gapMs>                   OK PACE          (chunk 0 = MTU-3; gap between chunks of one TX)
//   DROP                                   OK DROP, then EVT DISC <reason>
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <stdarg.h>

// PEA meter service, then the generic FFE0 UART family (same order as src/ble/uuids.ts).
static const char* SERVICES[] = {"b973f2e0-b19e-11e2-9e96-0800200c9a66", "ffe0"};

static NimBLEClient* cli;
static NimBLERemoteCharacteristic* wr;
static NimBLERemoteCharacteristic* nt;
static SemaphoreHandle_t outLock;  // lines come from loop() and from the BLE host task
static uint32_t t0;
static uint16_t paceChunk = 0, paceGap = 0;

static unsigned long us() { return (unsigned long)(micros() - t0); }

static void out(const char* fmt, ...) {
  char b[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(b, sizeof b, fmt, ap);
  va_end(ap);
  xSemaphoreTake(outLock, portMAX_DELAY);
  Serial.println(b);
  xSemaphoreGive(outLock);
}

// shortcut: prints straight from the BLE host task, so a stalled USB host stalls BLE; move to a queue if RX lines get lost
static void onNotify(NimBLERemoteCharacteristic*, uint8_t* d, size_t n, bool) {
  static const char H[] = "0123456789abcdef";
  char b[65];
  xSemaphoreTake(outLock, portMAX_DELAY);
  Serial.print("RX ");
  for (size_t i = 0; i < n;) {
    size_t k = 0;
    for (; i < n && k < 64; i++) { b[k++] = H[d[i] >> 4]; b[k++] = H[d[i] & 15]; }
    b[k] = 0;
    Serial.print(b);
  }
  Serial.println();
  xSemaphoreGive(outLock);
}

struct ScanCb : NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* d) override {
    out("ADV %s %u %d %lu %s", d->getAddress().toString().c_str(), d->getAddress().getType(), d->getRSSI(),
        (unsigned long)micros(), d->getName().c_str());
  }
  void onScanEnd(const NimBLEScanResults&, int) override { out("SCANEND"); }
} scanCb;

struct CliCb : NimBLEClientCallbacks {
  void onConnect(NimBLEClient*) override { out("EVT CONNECTED %lu", us()); }
  void onDisconnect(NimBLEClient*, int reason) override { wr = nt = nullptr; out("EVT DISC %d", reason); }
  void onMTUChange(NimBLEClient*, uint16_t mtu) override { out("EVT MTU %lu %u", us(), mtu); }
  void onPhyUpdate(NimBLEClient*, uint8_t tx, uint8_t rx) override { out("EVT PHY %lu %u %u", us(), tx, rx); }
} cliCb;

static bool up() { return cli->isConnected() && wr && nt; }

// shortcut: connect() blocks loop(), so DROP/STOP are not seen until it returns or times out
static void cmdConn(const char* mac, int type, int itvl, int toMs) {
  t0 = micros();
  if (cli->isConnected()) return out("ERR CONN busy");
  NimBLEDevice::getScan()->stop();
  cli->setConnectTimeout(toMs);
  cli->setConnectionParams(itvl, itvl, 0, 200, 16, 16);  // supervision timeout 2 s; scan window = interval while waiting for the advert
  if (!cli->connect(NimBLEAddress(std::string(mac), (uint8_t)type))) return out("ERR CONN connect %d", cli->getLastError());
  NimBLERemoteCharacteristic *w = nullptr, *n = nullptr;
  for (const char* u : SERVICES) {
    NimBLERemoteService* s = cli->getService(u);
    if (!s) continue;
    // chosen by property, like connectMeter() in the web app
    for (NimBLERemoteCharacteristic* c : s->getCharacteristics(true)) {
      if (!w && (c->canWrite() || c->canWriteNoResponse())) w = c;
      if (!n && c->canNotify()) n = c;
    }
    if (w && n) break;
    w = n = nullptr;
  }
  if (!w || !n) { cli->disconnect(); return out("ERR CONN nochar"); }
  out("EVT DISCOVERED %lu %u %u", us(), w->getHandle(), n->getHandle());
  if (!n->subscribe(true, onNotify)) { cli->disconnect(); return out("ERR CONN subscribe"); }
  wr = w; nt = n;
  out("EVT READY %lu %u %u %d", us(), cli->getMTU(), cli->getConnInfo().getConnInterval(), wr->canWriteNoResponse() ? 1 : 0);
}

static int nib(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }

static void cmdTx(const char* hex) {
  static uint8_t buf[600];
  if (!up()) return out("ERR TX notconn");
  size_t n = 0;
  for (; hex[0] && hex[1]; hex += 2) {
    int a = nib(hex[0]), b = nib(hex[1]);
    if (a < 0 || b < 0 || n >= sizeof buf) return out("ERR TX hex");
    buf[n++] = (uint8_t)(a << 4 | b);
  }
  bool noRsp = wr->canWriteNoResponse();
  size_t step = paceChunk ? paceChunk : cli->getMTU() - 3;
  for (size_t i = 0; i < n; i += step) {
    size_t k = n - i < step ? n - i : step;
    // a write without response fails while the stack is out of buffers: wait and retry
    for (int tries = 0; !wr->writeValue(buf + i, k, !noRsp); delay(2))
      if (++tries > 100 || !up()) return out("ERR TX write");
    if (paceGap && i + step < n) delay(paceGap);
  }
  out("OK TX");
}

static void handle(char* line) {
  char* arg = strchr(line, ' ');
  if (arg) *arg++ = 0; else arg = line + strlen(line);
  int a = 0, b = 0, c = 0;
  char s[24] = "";
  if (!strcmp(line, "TX")) cmdTx(arg);
  else if (!strcmp(line, "CONN")) {
    if (sscanf(arg, "%23s %d %d %d", s, &a, &b, &c) < 2) return out("ERR CONN args");
    cmdConn(s, a, b >= 6 ? b : 6, c > 0 ? c : 10000);
  } else if (!strcmp(line, "SCAN")) {
    sscanf(arg, "%d %1s", &a, s);
    NimBLEScan* sc = NimBLEDevice::getScan();
    sc->setActiveScan(s[0] == 'A');
    if (!sc->start(a > 0 ? a : 5000)) out("ERR SCAN start");
  } else if (!strcmp(line, "STOP")) { NimBLEDevice::getScan()->stop(); out("OK STOP"); }
  else if (!strcmp(line, "DROP")) { if (cli->isConnected()) cli->disconnect(); out("OK DROP"); }
  else if (!strcmp(line, "INFO")) {
    if (!cli->isConnected()) return out("ERR INFO notconn");
    out("OK INFO %u %u %d", cli->getMTU(), cli->getConnInfo().getConnInterval(), cli->getRssi());
  } else if (!strcmp(line, "ITVL")) {
    a = atoi(arg);
    out(cli->isConnected() && cli->updateConnParams(a, a, 0, 200) ? "OK ITVL" : "ERR ITVL");
  } else if (!strcmp(line, "PHY")) {
    a = atoi(arg);
    out(cli->isConnected() && cli->updatePhy(a, a) ? "OK PHY" : "ERR PHY");
  } else if (!strcmp(line, "PWR")) out(NimBLEDevice::setPower((int8_t)atoi(arg)) ? "OK PWR" : "ERR PWR");
  else if (!strcmp(line, "ANT")) {
#if CONFIG_IDF_TARGET_ESP32C6
    // Seeed XIAO ESP32-C6 only: GPIO3 low powers the RF switch, GPIO14 high selects the u.FL connector
    pinMode(3, OUTPUT); digitalWrite(3, LOW);
    pinMode(14, OUTPUT); digitalWrite(14, atoi(arg) ? HIGH : LOW);
    out("OK ANT");
#else
    out("ERR ANT noswitch");
#endif
  } else if (!strcmp(line, "PACE")) { sscanf(arg, "%d %d", &a, &b); paceChunk = a; paceGap = b; out("OK PACE"); }
  else if (!strcmp(line, "VER")) out("OK VER radio-head 1 " __DATE__);
  else out("ERR %s unknown", line);
}

void setup() {
  outLock = xSemaphoreCreateMutex();
  Serial.begin(115200);
  NimBLEDevice::init("");
  NimBLEDevice::setMTU(247);
  cli = NimBLEDevice::createClient();
  cli->setClientCallbacks(&cliCb, false);
  NimBLEScan* sc = NimBLEDevice::getScan();
  sc->setScanCallbacks(&scanCb, true);  // report every advert, so the host can measure the advertising interval
  sc->setDuplicateFilter(0);
  sc->setMaxResults(0);                 // callbacks only, keep nothing
  sc->setInterval(30);
  sc->setWindow(30);                    // window = interval: listening all the time
}

void loop() {
  static char line[1300];
  static size_t n = 0;
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch != '\n') { if (n < sizeof line - 1) line[n++] = ch; continue; }
    line[n] = 0;
    n = 0;
    if (line[0]) handle(line);
  }
  delay(1);
}
