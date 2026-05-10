# ESP32 RFID Firebase Register

This project uses an ESP32 with an MFRC522 RFID reader to scan RFID cards and send the detected UID to Firebase Realtime Database.

## Features

- Connects the ESP32 to a WiFi network.
- Reads RFID card UIDs using the MFRC522 module.
- Converts the card UID to hexadecimal format.
- Uploads the latest scanned UID to Firebase.
- Runs continuously and waits for the next RFID card scan.

## Project Structure

```text
register/
├── main.py       # Main ESP32 program for WiFi, RFID scanning, and Firebase upload
├── mfrc522.py    # MFRC522 RFID reader driver
└── README.md     # Project documentation
```

## Hardware Requirements

- ESP32 development board
- MFRC522 RFID reader module
- RFID card or tag
- Jumper wires
- WiFi connection

## Pin Configuration

| MFRC522 Pin | ESP32 Pin |
| --- | --- |
| SCK | GPIO 25 |
| MOSI | GPIO 33 |
| MISO | GPIO 32 |
| SDA / SS | GPIO 26 |
| RST | GPIO 12 |
| 3.3V | 3.3V |
| GND | GND |

## Software Requirements

- MicroPython installed on the ESP32
- `main.py` uploaded to the ESP32
- `mfrc522.py` uploaded to the ESP32
- Firebase Realtime Database project

The program uses these MicroPython modules:

- `machine`
- `network`
- `time`
- `urequests`

## Configuration

Update the WiFi settings in `main.py`:

```python
WIFI_SSID = "Your WiFi Name"
WIFI_PASS = "Your WiFi Password"
```

Update the Firebase Realtime Database URL:

```python
FIREBASE_URL = "https://your-project-default-rtdb.firebaseio.com/rfid/pending.json"
```

Before uploading this project to GitHub, avoid committing real WiFi passwords or private Firebase credentials.

## Firebase Data Format

Each scanned card is sent to Firebase in this format:

```json
{
  "uid": "A1B2C3D4",
  "scannedAt": 1710000000000,
  "source": "esp32"
}
```

The data is written to:

```text
/rfid/pending
```

## How It Works

1. The ESP32 starts and resets the MFRC522 reader.
2. The program connects to the configured WiFi network.
3. The RFID reader waits for a nearby card.
4. When a card is detected, the UID is read and converted to hexadecimal.
5. The UID is uploaded to Firebase.
6. The ESP32 waits for the next card.

## Usage

1. Flash MicroPython to the ESP32.
2. Upload `main.py` and `mfrc522.py` to the ESP32.
3. Configure WiFi and Firebase in `main.py`.
4. Reset or power on the ESP32.
5. Scan an RFID card.
6. Check Firebase Realtime Database for the latest UID.

## Example Serial Output

```text
Connecting to WiFi...
WiFi connected. IP: 192.168.1.20

System ready! Please scan a card...

Card detected! UID: A1B2C3D4
Writing directly to /rfid/pending...
Firebase result: 200
Response: {"uid":"A1B2C3D4","scannedAt":1710000000000,"source":"esp32"}
Ready to scan the next card...
```

## Notes

- Use 3.3V for the MFRC522 module. Do not connect it to 5V.
- Make sure Firebase rules allow the ESP32 to write to the database path.
- If WiFi connection fails, check the SSID, password, and network signal.
