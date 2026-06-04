from machine import Pin, SoftSPI, WDT, reset
from mfrc522 import MFRC522
import network
import time
import urequests

# WIFI 1
WIFI_SSID = "ETEAMS 2.4G"
WIFI_PASS = "Eteams@123"
# WIFI 2
# WIFI_SSID = "ThomasW"
# WIFI_PASS = "12345678"

# --- FIREBASE CONFIGURATION ---
FIREBASE_URL = "https://student-management-1d269-default-rtdb.asia-southeast1.firebasedatabase.app/rfid/pending.json"

# --- WATCHDOG CONFIGURATION ---
WDT_TIMEOUT_MS = 8000       # Hardware WDT: reset nếu không feed trong 8 giây
WIFI_CHECK_INTERVAL = 30    # Kiểm tra WiFi mỗi 30 giây
RFID_FAIL_THRESHOLD = 100   # Reset RFID reader sau N lần thất bại liên tiếp

# --- RFID PIN CONFIGURATION ---
sck  = Pin(25)
mosi = Pin(33)
miso = Pin(32)
sda  = Pin(26, Pin.OUT)
rst  = Pin(12, Pin.OUT)

def init_rfid():
    """Hard reset rồi khởi động lại MFRC522."""
    rst.value(0)
    time.sleep_ms(50)
    rst.value(1)
    time.sleep_ms(50)
    spi = SoftSPI(baudrate=1000000, polarity=0, phase=0, sck=sck, mosi=mosi, miso=miso)
    return MFRC522(spi, sda)

def connect_wifi(wdt=None):
    """Kết nối WiFi, feed WDT trong khi chờ để tránh bị reset."""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    if not wlan.isconnected():
        print("Connecting to WiFi...")
        wlan.connect(WIFI_SSID, WIFI_PASS)

        timeout = 30
        while not wlan.isconnected() and timeout > 0:
            if wdt:
                wdt.feed()
            time.sleep(1)
            timeout -= 1

    if wlan.isconnected():
        print("WiFi connected. IP:", wlan.ifconfig()[0])
        return True

    print("WiFi connection failed!")
    return False

def send_to_firebase(uid_hex, wdt=None):
    """Gửi UID lên Firebase, feed WDT trước/sau request mạng."""
    payload = {
        "uid": uid_hex,
        "scannedAt": int(time.time() * 1000),
        "source": "esp32"
    }
    try:
        print("Writing to /rfid/pending...")
        if wdt:
            wdt.feed()
        response = urequests.put(FIREBASE_URL, json=payload)
        if wdt:
            wdt.feed()
        print("Firebase result:", response.status_code)
        print("Response:", response.text)
        response.close()
        return True
    except Exception as e:
        print("Error sending to Firebase:", e)
        return False

def main():
    # Khởi động hardware watchdog — ESP32 tự reset nếu code bị treo > 8s
    wdt = WDT(timeout=WDT_TIMEOUT_MS)
    wdt.feed()

    if not connect_wifi(wdt):
        print("WiFi failed. Resetting in 3s...")
        time.sleep(3)
        reset()

    wdt.feed()
    rdr = init_rfid()

    print("\nSystem ready! Please scan a card...")

    last_wifi_check = time.ticks_ms()
    rfid_fail_count = 0

    while True:
        wdt.feed()

        # --- Watchdog WiFi: tự động kết nối lại nếu mất mạng ---
        if time.ticks_diff(time.ticks_ms(), last_wifi_check) >= WIFI_CHECK_INTERVAL * 1000:
            wlan = network.WLAN(network.STA_IF)
            if not wlan.isconnected():
                print("WiFi lost! Reconnecting...")
                connect_wifi(wdt)
            last_wifi_check = time.ticks_ms()
            wdt.feed()

        # --- Đọc thẻ RFID ---
        try:
            (stat, _) = rdr.request(rdr.REQIDL)

            if stat == rdr.OK:
                rfid_fail_count = 0
                (stat, raw_uid) = rdr.anticoll()

                if stat == rdr.OK:
                    uid_hex = "{:02X}{:02X}{:02X}{:02X}".format(*raw_uid[:4])
                    print(f"\nCard detected! UID: {uid_hex}")

                    send_to_firebase(uid_hex, wdt)
                    wdt.feed()

                    # Chia nhỏ sleep 2s để feed WDT liên tục
                    for _ in range(4):
                        time.sleep_ms(500)
                        wdt.feed()

                    print("Ready to scan the next card...")
            else:
                rfid_fail_count += 1
                # --- Watchdog RFID: reset reader nếu liên tục thất bại ---
                if rfid_fail_count >= RFID_FAIL_THRESHOLD:
                    print("RFID reader stuck! Resetting reader...")
                    rdr = init_rfid()
                    rfid_fail_count = 0
                    wdt.feed()

        except Exception as e:
            print("Loop error:", e)
            rfid_fail_count += 1

        time.sleep_ms(100)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("Fatal error:", e)
        time.sleep(2)
        reset()
