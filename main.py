from machine import Pin, SoftSPI
from mfrc522 import MFRC522
import network
import time
import urequests
import json

# WIFI 1
# WIFI_SSID = "ETEAMS 2.4G"
# WIFI_PASS = "Eteams@123"
# WIFI 2
WIFI_SSID = "ThomasW"
WIFI_PASS = "12345678"

# --- FIREBASE CONFIGURATION ---
FIREBASE_URL = "https://student-management-1d269-default-rtdb.asia-southeast1.firebasedatabase.app/rfid/pending.json"

# --- RFID PIN CONFIGURATION ---
sck = Pin(25)
mosi = Pin(33)
miso = Pin(32)
sda = Pin(26, Pin.OUT)

# RFID reset pin.
rst = Pin(12, Pin.OUT)

# Hard reset the MFRC522 when the device starts.
rst.value(0)
time.sleep_ms(100)
rst.value(1)
time.sleep_ms(100)

# Initialize the SPI bus.
spi = SoftSPI(
    baudrate=1000000,
    polarity=0,
    phase=0,
    sck=sck,
    mosi=mosi,
    miso=miso
)

# Initialize the RFID reader.
rdr = MFRC522(spi, sda)

# Connects the ESP32 to the configured WiFi network.
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    if not wlan.isconnected():
        print("Connecting to WiFi...")
        wlan.connect(WIFI_SSID, WIFI_PASS)

        timeout = 100
        while not wlan.isconnected() and timeout > 0:
            time.sleep(1)
            timeout -= 1

    if wlan.isconnected():
        print("WiFi connected. IP:", wlan.ifconfig()[0])
        return True

    print("WiFi connection failed!")
    return False

# Sends the scanned RFID UID to Firebase as the current pending scan.
def send_to_firebase(uid_hex):
    payload = {
        "uid": uid_hex,
        "scannedAt": int(time.time() * 1000),
        "source": "esp32"
    }

    try:
        print("Writing directly to /rfid/pending...")

        response = urequests.put(FIREBASE_URL, json=payload)

        print("Firebase result:", response.status_code)
        print("Response:", response.text)

        response.close()

    except Exception as e:
        print("Error sending to Firebase:", e)

# Starts WiFi, reads RFID cards continuously, and uploads detected UIDs.
def main():
    if not connect_wifi():
        return

    print("\nSystem ready! Please scan a card...")

    while True:
        (stat, tag_type) = rdr.request(rdr.REQIDL)

        if stat == rdr.OK:
            (stat, raw_uid) = rdr.anticoll()

            if stat == rdr.OK:
                uid_hex = "{:02X}{:02X}{:02X}{:02X}".format(*raw_uid[:4])

                print(f"\nCard detected! UID: {uid_hex}")

                send_to_firebase(uid_hex)

                time.sleep(2)

                print("Ready to scan the next card...")

        time.sleep_ms(100)

if __name__ == "__main__":
    main()
