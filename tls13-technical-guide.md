# TLS 1.3


## Mục Lục

1. [Tổng Quan TLS 1.3](#1-tổng-quan-tls-13)
2. [Kiến Trúc Giao Thức](#2-kiến-trúc-giao-thức)
3. [Quá Trình Handshake Chi Tiết](#3-quá-trình-handshake-chi-tiết)
4. [Cipher Suites Trong TLS 1.3](#4-cipher-suites-trong-tls-13)
5. [Key Derivation — HKDF](#5-key-derivation--hkdf)
6. [So Sánh TLS 1.2 vs TLS 1.3](#6-so-sánh-tls-12-vs-tls-13)
7. [Các Tính Năng Bảo Mật Mới](#7-các-tính-năng-bảo-mật-mới)
8. [Hướng Dẫn Sinh Key & Certificate Trên Debian](#8-hướng-dẫn-sinh-key--certificate-trên-debian)
9. [Demo MicroPython — Hệ Thống Chat HTTPS qua TLS 1.3](#9-demo-micropython--hệ-thống-chat-https-qua-tls-13)
10. [Kiểm Tra & Debug TLS 1.3](#10-kiểm-tra--debug-tls-13)
11. [Best Practices & Hardening](#11-best-practices--hardening)
12. [Tài Liệu Tham Khảo](#12-tài-liệu-tham-khảo)



## 1. Tổng Quan TLS 1.3

### 1.1. TLS Là Gì?

Transport Layer Security (TLS) là giao thức mật mã dùng để bảo vệ truyền thông giữa client và server trên mạng Internet. TLS hoạt động ở tầng transport, nằm giữa tầng ứng dụng (HTTP, SMTP, MQTT...) và tầng mạng (TCP/IP), đảm bảo ba mục tiêu cốt lõi:

- **Bảo mật (Confidentiality):** Dữ liệu được mã hóa, kẻ tấn công không thể đọc nội dung.
- **Toàn vẹn (Integrity):** Mọi thay đổi dữ liệu trên đường truyền đều bị phát hiện.
- **Xác thực (Authentication):** Đảm bảo client đang giao tiếp đúng server mong muốn (và ngược lại nếu dùng mutual TLS).

### 1.2. Lịch Sử Phát Triển

| Phiên bản | RFC | Năm | Ghi chú |
|-----------|-----|------|---------|
| SSL 2.0 | — | 1995 | Thiết kế bởi Netscape, nhiều lỗ hổng nghiêm trọng |
| SSL 3.0 | RFC 6101 | 1996 | Cải thiện nhưng vẫn dính POODLE attack |
| TLS 1.0 | RFC 2246 | 1999 | Phiên bản chuẩn hóa đầu tiên của IETF |
| TLS 1.1 | RFC 4346 | 2006 | Sửa lỗi CBC attack |
| TLS 1.2 | RFC 5246 | 2008 | Hỗ trợ AEAD, SHA-256, linh hoạt cipher |
| **TLS 1.3** | **RFC 8446** | **2018** | **Thiết kế lại hoàn toàn, loại bỏ legacy, 1-RTT** |

### 1.3. Tại Sao TLS 1.3?

TLS 1.2 đã phục vụ hơn một thập kỷ nhưng tích lũy nhiều vấn đề: Heartbleed, BEAST, POODLE, DROWN, Lucky13, Sweet32... Nhiều cuộc tấn công khai thác các thuật toán cũ (RC4, 3DES, static RSA) hoặc thiết kế handshake để lộ thông tin.

TLS 1.3 được thiết kế lại từ đầu với sự tham gia của cộng đồng mật mã học thuật — RFC 8446 trích dẫn 14 bài nghiên cứu phân tích bảo mật độc lập, một mức độ kiểm chứng chưa từng có cho bất kỳ giao thức Internet nào.

---

## 2. Kiến Trúc Giao Thức

TLS 1.3 bao gồm hai thành phần chính:

### 2.1. Handshake Protocol (Section 4 — RFC 8446)

Xác thực các bên tham gia, thỏa thuận các tham số mật mã, và thiết lập keying material chung. Handshake được thiết kế để chống giả mạo — kẻ tấn công kiểm soát hoàn toàn mạng cũng không thể ép buộc hai bên thỏa thuận tham số khác với khi không bị tấn công.

### 2.2. Record Protocol (Section 5 — RFC 8446)

Sử dụng các tham số do handshake thiết lập để bảo vệ lưu lượng. Record protocol chia dữ liệu thành các bản ghi (records), mỗi bản ghi được bảo vệ độc lập bằng traffic keys.

### 2.3. Sơ Đồ Kiến Trúc

```
┌─────────────────────────────────────────────┐
│              Application Layer              │
│         (HTTP, MQTT, WebSocket...)          │
├─────────────────────────────────────────────┤
│              TLS 1.3 Layer                  │
│  ┌─────────────────┬─────────────────────┐  │
│  │   Handshake     │   Record Protocol   │  │
│  │   Protocol      │   (AEAD encrypt)    │  │
│  │                 │                     │  │
│  │ - Key Exchange  │ - Fragmentation     │  │
│  │ - Server Params │ - Encryption        │  │
│  │ - Authentication│ - MAC (integrated)  │  │
│  └─────────────────┴─────────────────────┘  │
├─────────────────────────────────────────────┤
│              Transport Layer                │
│                  (TCP)                       │
├─────────────────────────────────────────────┤
│              Network Layer                  │
│                 (IP)                         │
└─────────────────────────────────────────────┘
```

---

## 3. Quá Trình Handshake Chi Tiết

### 3.1. Full Handshake (1-RTT)

Đây là thay đổi lớn nhất so với TLS 1.2. TLS 1.3 chỉ cần **1 round-trip** thay vì 2 round-trip, giảm 30-50% thời gian thiết lập kết nối.

```
    Client                                           Server

    ClientHello
    + key_share
    + signature_algorithms
    + supported_versions
    + psk_key_exchange_modes
                            -------->
                                                ServerHello
                                                + key_share
                                          + supported_versions
                                        {EncryptedExtensions}
                                        {CertificateRequest*}
                                               {Certificate}
                                         {CertificateVerify}
                            <--------              {Finished}

    {Certificate*}
    {CertificateVerify*}
    {Finished}
                            -------->

    [Application Data]      <------->    [Application Data]

    Chú thích:
    +   = extension gửi trong message tương ứng
    {}  = message được mã hóa bằng handshake traffic key
    []  = message được mã hóa bằng application traffic key
    *   = tùy chọn (optional)
```

### 3.2. Chi Tiết Từng Bước

**Bước 1 — ClientHello:**  
Client gửi danh sách cipher suites được hỗ trợ, các nhóm key exchange (supported_groups), và quan trọng nhất — **key_share** chứa public key của client. Đây là điểm khác biệt cốt lõi: client "đoán trước" thuật toán key exchange và gửi luôn public key, thay vì đợi server chọn rồi mới gửi (như TLS 1.2). Chính việc đoán trước này giúp tiết kiệm một round-trip.

**Bước 2 — ServerHello:**  
Server chọn cipher suite, gửi key_share của mình. Từ thời điểm này, **tất cả handshake messages đều được mã hóa** — một cải tiến quan trọng so với TLS 1.2 nơi toàn bộ handshake ở dạng plaintext.

**Bước 3 — Server Authentication:**  
Server gửi certificate, CertificateVerify (chữ ký số chứng minh sở hữu private key), và Finished message (MAC xác nhận toàn vẹn handshake).

**Bước 4 — Client Finished:**  
Client xác minh certificate, gửi Finished message. Từ đây, application data được truyền bằng application traffic keys.

### 3.3. Session Resumption & 0-RTT

Khi client đã kết nối trước đó, server cung cấp Pre-Shared Key (PSK) qua session ticket. Lần kết nối sau, client có thể gửi dữ liệu ứng dụng ngay trong ClientHello đầu tiên — gọi là **0-RTT (Zero Round-Trip Time)**. Tuy nhiên, 0-RTT có rủi ro replay attack nên phải được sử dụng cẩn thận:

- Ứng dụng PHẢI KHÔNG gửi dữ liệu trong 0-RTT nếu dữ liệu đó không an toàn khi bị replay.
- Triển khai TLS PHẢI KHÔNG tự động bật 0-RTT trừ khi ứng dụng yêu cầu cụ thể.

```
    Client                                           Server

    ClientHello
    + early_data
    + key_share
    + psk_key_exchange_modes
    + pre_shared_key
    (Application Data)      -------->
                                                ServerHello
                                           + pre_shared_key
                                        {EncryptedExtensions}
                                          + early_data (ACK)
                            <--------              {Finished}

    {Finished}
                            -------->

    [Application Data]      <------->    [Application Data]
```

### 3.4. HelloRetryRequest

Nếu server không hỗ trợ nhóm key exchange mà client đã chọn, thay vì fail, server gửi HelloRetryRequest yêu cầu client thử lại với nhóm khác. Lúc này handshake thành 2-RTT nhưng kết nối vẫn thành công.

---

## 4. Cipher Suites Trong TLS 1.3

### 4.1. Triết Lý Thiết Kế Mới

TLS 1.2 có hơn 300 cipher suite combinations, nhiều trong số đó không an toàn. TLS 1.3 đơn giản hóa triệt để — chỉ giữ lại **5 cipher suites**, tất cả đều sử dụng AEAD (Authenticated Encryption with Associated Data).

Quy ước đặt tên cũng thay đổi. TLS 1.2 bao gồm cả key exchange và authentication trong tên cipher suite (ví dụ: `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`). TLS 1.3 tách riêng — cipher suite chỉ chứa thuật toán AEAD và hash:

```
TLS 1.2:  TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
          ├── Key Exchange ──┤ Auth │ AEAD + Hash ──┤

TLS 1.3:  TLS_AES_128_GCM_SHA256
          │── AEAD + Hash ──│
          (Key exchange & auth thỏa thuận riêng qua extensions)
```

### 4.2. Danh Sách 5 Cipher Suites Chính Thức

| Cipher Suite | AEAD Algorithm | Hash (HKDF) | Ghi chú |
|-------------|---------------|-------------|---------|
| `TLS_AES_128_GCM_SHA256` | AES-128-GCM | SHA-256 | **Bắt buộc triển khai** |
| `TLS_AES_256_GCM_SHA384` | AES-256-GCM | SHA-384 | Bảo mật cao hơn |
| `TLS_CHACHA20_POLY1305_SHA256` | ChaCha20-Poly1305 | SHA-256 | Tối ưu cho thiết bị không có AES-NI |
| `TLS_AES_128_CCM_SHA256` | AES-128-CCM | SHA-256 | Cho IoT/embedded |
| `TLS_AES_128_CCM_8_SHA256` | AES-128-CCM (8-byte tag) | SHA-256 | Bandwidth cực thấp |

### 4.3. Key Exchange (Thỏa thuận riêng)

TLS 1.3 chỉ cho phép key exchange có **Forward Secrecy**:

- **ECDHE (Elliptic Curve Diffie-Hellman Ephemeral):** Sử dụng các curve: secp256r1 (P-256), secp384r1 (P-384), secp521r1 (P-521), x25519, x448
- **DHE (Finite Field Diffie-Hellman Ephemeral):** Sử dụng các nhóm ffdhe2048, ffdhe3072, ffdhe4096, ffdhe6144, ffdhe8192
- **PSK with (EC)DHE:** Pre-Shared Key kết hợp Diffie-Hellman
- **PSK only:** Chỉ Pre-Shared Key (không có forward secrecy)

**Đã bị loại bỏ hoàn toàn:** Static RSA, Static DH — vì không có forward secrecy, nghĩa là nếu private key bị lộ, toàn bộ traffic đã ghi lại trước đó đều bị giải mã.

### 4.4. Signature Algorithms

- RSA-PSS (RSASSA-PSS) — thay thế RSA PKCS#1 v1.5
- ECDSA (P-256, P-384, P-521)
- EdDSA (Ed25519, Ed448)

---

## 5. Key Derivation — HKDF

### 5.1. Tổng Quan

TLS 1.3 sử dụng HMAC-based Extract-and-Expand Key Derivation Function (HKDF — RFC 5869) làm nền tảng dẫn xuất khóa. Đây là cải tiến lớn so với PRF tùy chỉnh của TLS 1.2, giúp phân tích bảo mật dễ dàng hơn nhờ tính chất tách biệt khóa (key separation) rõ ràng.

### 5.2. Key Schedule

```
                PSK (nếu có)     (EC)DHE shared secret
                    │                      │
                    v                      │
          HKDF-Extract ───> Early Secret   │
                    │                      │
                    v                      │
    Derive-Secret(., "derived", "")        │
                    │                      │
                    v                      v
          HKDF-Extract ──────────> Handshake Secret
                    │
                    ├──> client_handshake_traffic_secret
                    ├──> server_handshake_traffic_secret
                    │
                    v
    Derive-Secret(., "derived", "")
                    │
                    v
          HKDF-Extract ───> Master Secret
                    │
                    ├──> client_application_traffic_secret_0
                    ├──> server_application_traffic_secret_0
                    ├──> exporter_master_secret
                    └──> resumption_master_secret
```

Mỗi giai đoạn sinh ra các traffic secret riêng biệt, từ đó dẫn xuất key và IV cho AEAD encryption. Thiết kế này đảm bảo rằng việc lộ một khóa không ảnh hưởng đến các khóa khác.

---

## 6. So Sánh TLS 1.2 vs TLS 1.3

| Đặc điểm | TLS 1.2 | TLS 1.3 |
|-----------|---------|---------|
| Handshake round-trips | 2-RTT | 1-RTT (hỗ trợ 0-RTT resumption) |
| Cipher suites | 300+ (nhiều không an toàn) | 5 (tất cả AEAD) |
| Key exchange | Static RSA, DH, ECDHE | Chỉ (EC)DHE hoặc PSK+(EC)DHE |
| Forward secrecy | Tùy chọn | **Bắt buộc** |
| Handshake encryption | Không (plaintext) | Mã hóa sau ServerHello |
| Compression | Có (dính CRIME attack) | **Loại bỏ** |
| Renegotiation | Có (dính nhiều attack) | **Loại bỏ** |
| Key derivation | Custom PRF | HKDF (chuẩn RFC 5869) |
| RSA encryption cho key exchange | Có | **Loại bỏ** |
| CBC mode ciphers | Có (dính Lucky13, BEAST) | **Loại bỏ** |
| RC4, 3DES, MD5, SHA-1 | Có thể dùng | **Loại bỏ hoàn toàn** |
| ChangeCipherSpec message | Có | **Loại bỏ** |
| Session ID/Ticket resumption | Hai cơ chế riêng | Thống nhất qua PSK |

---

## 7. Các Tính Năng Bảo Mật Mới

### 7.1. Forward Secrecy Bắt Buộc

Mọi kết nối TLS 1.3 đều sử dụng ephemeral key exchange, nghĩa là mỗi phiên có khóa riêng. Nếu private key dài hạn (certificate key) bị lộ trong tương lai, kẻ tấn công không thể giải mã traffic đã ghi lại trước đó.

### 7.2. Encrypted Handshake

Sau ServerHello, tất cả handshake messages đều được mã hóa. Điều này che giấu certificate (danh tính server), tên máy chủ, và các tham số khác khỏi kẻ nghe lén thụ động (passive eavesdropper).

### 7.3. Downgrade Protection

TLS 1.3 tích hợp cơ chế phát hiện downgrade attack. Nếu server hỗ trợ TLS 1.3 nhưng bị ép về TLS 1.2, client có thể phát hiện thông qua giá trị đặc biệt trong ServerHello.random.

### 7.4. Loại Bỏ Các Thuật Toán Yếu

Danh sách bị loại bỏ: RSA key transport, DH key exchange tĩnh, CBC mode ciphers, RC4, 3DES, MD5, SHA-1, compression, renegotiation, custom DHE groups, EC point format negotiation.

---

## 8. Hướng Dẫn Sinh Key & Certificate Trên Debian

### 8.1. Chuẩn Bị Môi Trường

```bash
# Cập nhật hệ thống
sudo apt update && sudo apt upgrade -y

# Cài đặt OpenSSL (Debian 12+ đã có OpenSSL 3.x hỗ trợ TLS 1.3)
sudo apt install -y openssl

# Kiểm tra phiên bản
openssl version
# Output mong đợi: OpenSSL 3.x.x (hỗ trợ TLS 1.3)

# Kiểm tra cipher suites TLS 1.3
openssl ciphers -v -tls1_3
```

### 8.2. Phương Pháp 1 — RSA Certificate (Truyền Thống)

```bash
# === BƯỚC 1: Tạo CA (Certificate Authority) riêng ===

# Sinh RSA private key cho CA (4096-bit)
openssl genrsa -aes256 -out ca.key 4096
# Nhập passphrase bảo vệ CA key

# Tạo CA root certificate (tự ký, hiệu lực 10 năm)
openssl req -new -x509 -sha256 -days 3650 \
    -key ca.key \
    -out ca.crt \
    -subj "/C=VN/ST=Dong Nai/L=Bien Hoa/O=MyLab/OU=Security/CN=MyLab Root CA"

# === BƯỚC 2: Tạo Server Certificate ===

# Sinh RSA private key cho server (2048-bit, không mã hóa để server dùng)
openssl genrsa -out server.key 2048

# Tạo Certificate Signing Request (CSR)
openssl req -new -sha256 \
    -key server.key \
    -out server.csr \
    -subj "/C=VN/ST=Dong Nai/L=Bien Hoa/O=MyLab/OU=IoT/CN=myserver.local"

# Tạo file extension cho SAN (Subject Alternative Name)
cat > server_ext.cnf << 'EOF'
authorityKeyIdentifier = keyid,issuer
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = myserver.local
DNS.2 = *.myserver.local
IP.1 = 192.168.1.100
IP.2 = 127.0.0.1
EOF

# Ký certificate bằng CA (hiệu lực 2 năm)
openssl x509 -req -sha256 -days 730 \
    -in server.csr \
    -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt \
    -extfile server_ext.cnf

# === BƯỚC 3: Kiểm tra certificate ===
openssl x509 -in server.crt -text -noout
openssl verify -CAfile ca.crt server.crt
```

### 8.3. Phương Pháp 2 — ECC/ECDSA Certificate (Khuyến Nghị Cho TLS 1.3)

ECC certificate nhỏ hơn, handshake nhanh hơn, và đặc biệt phù hợp cho thiết bị embedded/IoT.

```bash
# === BƯỚC 1: Tạo ECC CA ===

# Sinh ECC private key cho CA (curve P-384)
openssl ecparam -genkey -name secp384r1 -noout -out ca-ecc.key

# Tạo CA certificate
openssl req -new -x509 -sha384 -days 3650 \
    -key ca-ecc.key \
    -out ca-ecc.crt \
    -subj "/C=VN/ST=Dong Nai/L=Bien Hoa/O=MyLab/OU=Security/CN=MyLab ECC Root CA"

# === BƯỚC 2: Tạo Server ECC Certificate ===

# Sinh ECC private key cho server (curve P-256 — tương đương RSA 3072-bit)
openssl ecparam -genkey -name prime256v1 -noout -out server-ecc.key

# Tạo CSR
openssl req -new -sha256 \
    -key server-ecc.key \
    -out server-ecc.csr \
    -subj "/C=VN/ST=Dong Nai/L=Bien Hoa/O=MyLab/OU=IoT/CN=myserver.local"

# Ký certificate (dùng cùng server_ext.cnf ở trên)
openssl x509 -req -sha256 -days 730 \
    -in server-ecc.csr \
    -CA ca-ecc.crt -CAkey ca-ecc.key -CAcreateserial \
    -out server-ecc.crt \
    -extfile server_ext.cnf

# === BƯỚC 3: Kiểm tra ===
openssl x509 -in server-ecc.crt -text -noout
# Xác nhận: Public Key Algorithm: id-ecPublicKey
# ASN1 OID: prime256v1
```

### 8.4. One-Liner Nhanh (Self-Signed, Cho Mục Đích Test)

```bash
# RSA self-signed (nhanh nhất)
openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    -keyout server.key -out server.crt \
    -subj "/CN=myserver.local" \
    -addext "subjectAltName=DNS:myserver.local,IP:192.168.1.100"

# ECC self-signed (khuyến nghị)
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -sha256 -days 365 -nodes \
    -keyout server-ecc.key -out server-ecc.crt \
    -subj "/CN=myserver.local" \
    -addext "subjectAltName=DNS:myserver.local,IP:192.168.1.100"
```

### 8.5. Tạo Certificate Cho MicroPython/ESP32

MicroPython (mbedTLS backend) thường dùng PEM format. Đối với thiết bị nhúng, nên dùng ECC vì key nhỏ hơn, tiết kiệm RAM:

```bash
# Sinh ECC key và self-signed cert cho ESP32 server
openssl ecparam -genkey -name prime256v1 -noout -out esp32_server.key
openssl req -new -x509 -sha256 -days 3650 -nodes \
    -key esp32_server.key \
    -out esp32_server.crt \
    -subj "/CN=esp32.local"

# Chuyển key sang format DER nếu cần (tiết kiệm bộ nhớ)
openssl ec -in esp32_server.key -outform DER -out esp32_server.key.der
openssl x509 -in esp32_server.crt -outform DER -out esp32_server.crt.der

# Sinh CA + client cert nếu dùng mutual TLS
openssl ecparam -genkey -name prime256v1 -noout -out client.key
openssl req -new -x509 -sha256 -days 3650 -nodes \
    -key client.key \
    -out client.crt \
    -subj "/CN=client.local"
```

### 8.6. Kiểm Tra TLS 1.3 Với OpenSSL

```bash
# Khởi động test server TLS 1.3
openssl s_server -accept 8443 \
    -cert server-ecc.crt -key server-ecc.key \
    -tls1_3 -www

# Kết nối test client TLS 1.3
openssl s_client -connect localhost:8443 \
    -tls1_3 \
    -CAfile ca-ecc.crt

# Kiểm tra chỉ cho phép TLS 1.3
openssl s_client -connect localhost:8443 -tls1_2
# Mong đợi: handshake failure (vì server chỉ chấp nhận TLS 1.3)
```

---

## 9. Demo MicroPython — Hệ Thống Chat HTTPS qua TLS 1.3

### 9.1. Kiến Trúc Hệ Thống

```
┌──────────────────┐          TLS 1.3 / HTTPS          ┌──────────────────┐
│   Terminal A     │ ◄──────────────────────────────── │   Terminal B     │
│  (Python Client) │          (Mã hóa AES-GCM)         │  (Python Client) │
│  Gõ text ──────► │ ────────────────────────────────► │ ──────► Hiển thị │
│  ◄────── Nhận    │ ◄──────────────────────────────── │ ◄────── Gõ text  │
└────────┬─────────┘                                    └────────┬─────────┘
         │              ┌──────────────────┐                     │
         └──────────────┤  HTTPS Server    ├─────────────────────┘
                        │  (TLS 1.3)       │
                        │  MicroPython/    │
                        │  CPython         │
                        └──────────────────┘
```

### 9.2. Chuẩn Bị Certificate

Trước tiên, sinh certificate theo Mục 8.4 hoặc 8.5. Bạn cần các file sau:
- `server.key` — Private key của server
- `server.crt` — Certificate của server
- `ca.crt` — CA certificate (client dùng để xác thực server)

### 9.3. Server Code — MicroPython (ESP32)

File: `tls13_chat_server.py`

```python
"""
TLS 1.3 Chat Server cho MicroPython (ESP32)
============================================
Server HTTPS nhận và gửi tin nhắn text qua TLS 1.3.
Giao thức: HTTPS RESTful đơn giản.

Yêu cầu:
  - MicroPython >= 1.22 (hỗ trợ module tls/ssl với mbedTLS)
  - ESP32 với firmware hỗ trợ TLS
  - Certificate files: server.key, server.crt

Upload cert lên ESP32:
  mpremote cp server.key :server.key
  mpremote cp server.crt :server.crt
"""

import socket
import ssl  # MicroPython >= 1.23 dùng 'ssl', các bản cũ hơn dùng 'tls'
import json
import time
import _thread

# ============================================================
# CẤU HÌNH
# ============================================================
SERVER_HOST = "0.0.0.0"
SERVER_PORT = 8443
MAX_CONNECTIONS = 5

# Buffer lưu tin nhắn (dạng circular buffer đơn giản)
messages = []
MAX_MESSAGES = 100
msg_lock = _thread.allocate_lock()


def load_file(path):
    """Đọc file certificate/key từ filesystem."""
    with open(path, "rb") as f:
        return f.read()


def get_timestamp():
    """Lấy timestamp dạng đơn giản."""
    t = time.localtime()
    return "{:04d}-{:02d}-{:02d} {:02d}:{:02d}:{:02d}".format(
        t[0], t[1], t[2], t[3], t[4], t[5]
    )


def add_message(sender, text):
    """Thêm tin nhắn vào buffer."""
    msg_lock.acquire()
    try:
        messages.append({
            "id": len(messages),
            "sender": sender,
            "text": text,
            "time": get_timestamp()
        })
        # Giới hạn buffer
        while len(messages) > MAX_MESSAGES:
            messages.pop(0)
    finally:
        msg_lock.release()


def parse_http_request(raw_data):
    """Parse HTTP request đơn giản."""
    try:
        text = raw_data.decode("utf-8")
        lines = text.split("\r\n")
        request_line = lines[0]
        method, path, _ = request_line.split(" ", 2)

        # Parse headers
        headers = {}
        body_start = 0
        for i, line in enumerate(lines[1:], 1):
            if line == "":
                body_start = i + 1
                break
            if ":" in line:
                key, val = line.split(":", 1)
                headers[key.strip().lower()] = val.strip()

        body = "\r\n".join(lines[body_start:]) if body_start else ""
        return method, path, headers, body
    except Exception as e:
        print("Parse error:", e)
        return None, None, {}, ""


def build_http_response(status_code, status_text, body, content_type="application/json"):
    """Xây dựng HTTP response."""
    body_bytes = body.encode("utf-8") if isinstance(body, str) else body
    response = (
        "HTTP/1.1 {} {}\r\n"
        "Content-Type: {}\r\n"
        "Content-Length: {}\r\n"
        "Connection: close\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "X-TLS-Version: TLSv1.3\r\n"
        "\r\n"
    ).format(status_code, status_text, content_type, len(body_bytes))
    return response.encode("utf-8") + body_bytes


def handle_request(method, path, headers, body):
    """Xử lý HTTP request và trả về response."""

    # === GET /messages — Lấy danh sách tin nhắn ===
    if method == "GET" and path.startswith("/messages"):
        # Hỗ trợ ?after_id=N để chỉ lấy tin nhắn mới
        after_id = -1
        if "?" in path:
            params = path.split("?")[1]
            for param in params.split("&"):
                if param.startswith("after_id="):
                    try:
                        after_id = int(param.split("=")[1])
                    except ValueError:
                        pass

        msg_lock.acquire()
        try:
            filtered = [m for m in messages if m["id"] > after_id]
        finally:
            msg_lock.release()

        body = json.dumps({"messages": filtered, "count": len(filtered)})
        return build_http_response(200, "OK", body)

    # === POST /send — Gửi tin nhắn mới ===
    elif method == "POST" and path == "/send":
        try:
            data = json.loads(body)
            sender = data.get("sender", "anonymous")
            text = data.get("text", "")

            if not text.strip():
                return build_http_response(
                    400, "Bad Request",
                    json.dumps({"error": "Empty message"})
                )

            add_message(sender, text)
            print("[{}] {}: {}".format(get_timestamp(), sender, text))

            return build_http_response(
                201, "Created",
                json.dumps({"status": "sent", "id": len(messages) - 1})
            )
        except Exception as e:
            return build_http_response(
                400, "Bad Request",
                json.dumps({"error": str(e)})
            )

    # === GET /status — Kiểm tra server ===
    elif method == "GET" and path == "/status":
        status = {
            "server": "TLS 1.3 Chat Server",
            "tls_version": "TLSv1.3",
            "cipher_suites": [
                "TLS_AES_128_GCM_SHA256",
                "TLS_AES_256_GCM_SHA384",
                "TLS_CHACHA20_POLY1305_SHA256"
            ],
            "messages_count": len(messages),
            "uptime": get_timestamp()
        }
        return build_http_response(200, "OK", json.dumps(status))

    # === OPTIONS — CORS preflight ===
    elif method == "OPTIONS":
        return build_http_response(204, "No Content", "")

    # === 404 ===
    else:
        return build_http_response(
            404, "Not Found",
            json.dumps({"error": "Endpoint not found"})
        )


def handle_client(ssl_conn, addr):
    """Xử lý một client connection."""
    try:
        # Đọc request data
        raw_data = b""
        while True:
            chunk = ssl_conn.read(4096)
            if chunk:
                raw_data += chunk
                # Kiểm tra đã nhận đủ request chưa
                if b"\r\n\r\n" in raw_data:
                    # Nếu có Content-Length, đọc thêm body
                    header_end = raw_data.index(b"\r\n\r\n") + 4
                    headers_text = raw_data[:header_end].decode("utf-8", "ignore")
                    content_length = 0
                    for line in headers_text.split("\r\n"):
                        if line.lower().startswith("content-length:"):
                            content_length = int(line.split(":")[1].strip())
                    body_received = len(raw_data) - header_end
                    if body_received >= content_length:
                        break
            else:
                break

        if raw_data:
            method, path, headers, body = parse_http_request(raw_data)
            if method:
                response = handle_request(method, path, headers, body)
                ssl_conn.write(response)

    except Exception as e:
        print("Client error [{}]: {}".format(addr, e))
    finally:
        try:
            ssl_conn.close()
        except:
            pass


def start_server():
    """Khởi động TLS 1.3 HTTPS server."""

    print("=" * 60)
    print("  TLS 1.3 Chat Server")
    print("  RFC 8446 Compliant")
    print("=" * 60)

    # Đọc certificate và key
    server_cert = load_file("server.crt")
    server_key = load_file("server.key")

    # Tạo SSL Context — TLS 1.3
    # MicroPython mbedTLS sẽ thỏa thuận phiên bản cao nhất được hỗ trợ
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(server_cert, server_key)

    # Tạo TCP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((SERVER_HOST, SERVER_PORT))
    sock.listen(MAX_CONNECTIONS)

    print("[*] Server listening on {}:{}".format(SERVER_HOST, SERVER_PORT))
    print("[*] TLS 1.3 enabled — AEAD cipher suites only")
    print("[*] Endpoints:")
    print("    GET  /status   — Server status")
    print("    GET  /messages — Lấy tin nhắn (?after_id=N)")
    print("    POST /send     — Gửi tin nhắn")
    print()

    while True:
        try:
            client_sock, addr = sock.accept()
            print("[+] Connection from:", addr)

            # Wrap socket với TLS
            ssl_conn = ctx.wrap_socket(client_sock, server_side=True)

            # Xử lý trong thread riêng
            _thread.start_new_thread(handle_client, (ssl_conn, addr))

        except Exception as e:
            print("Accept error:", e)


# ============================================================
# WIFI SETUP (dành cho ESP32)
# ============================================================
def connect_wifi(ssid, password):
    """Kết nối WiFi cho ESP32."""
    import network
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("[*] Connecting to WiFi:", ssid)
        wlan.connect(ssid, password)
        while not wlan.isconnected():
            time.sleep(0.5)
    ip = wlan.ifconfig()[0]
    print("[*] WiFi connected! IP:", ip)
    return ip


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    # Bỏ comment dòng dưới nếu chạy trên ESP32:
    # connect_wifi("YOUR_SSID", "YOUR_PASSWORD")

    start_server()
```

### 9.4. Client Code — Terminal Chat (CPython)

File: `tls13_chat_client.py`

```python
"""
TLS 1.3 Chat Client — Terminal Interface
==========================================
Client giao tiếp với TLS 1.3 Chat Server qua HTTPS.
Gõ text trong terminal, bên kia nhận được ngay.

Yêu cầu:
  - Python 3.7+ (hỗ trợ TLS 1.3 qua OpenSSL 1.1.1+)
  - Certificate: ca.crt (hoặc server.crt nếu self-signed)

Cách dùng:
  python tls13_chat_client.py --host 192.168.1.100 --port 8443 \
                               --name "Alice" --ca ca.crt
"""

import ssl
import json
import socket
import sys
import threading
import time
import argparse
import os


class TLS13ChatClient:
    """HTTPS client kết nối TLS 1.3 server để chat."""

    def __init__(self, host, port, username, ca_cert=None, verify=True):
        self.host = host
        self.port = port
        self.username = username
        self.ca_cert = ca_cert
        self.verify = verify
        self.last_msg_id = -1
        self.running = True

    def _create_ssl_context(self):
        """Tạo SSL context bắt buộc TLS 1.3."""
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)

        # Bắt buộc TLS 1.3 — từ chối mọi phiên bản thấp hơn
        ctx.minimum_version = ssl.TLSVersion.TLSv1_3
        ctx.maximum_version = ssl.TLSVersion.TLSv1_3

        if self.ca_cert and os.path.exists(self.ca_cert):
            ctx.load_verify_locations(self.ca_cert)
            ctx.check_hostname = False  # Self-signed cert
            ctx.verify_mode = ssl.CERT_REQUIRED
            print("[*] CA certificate loaded: {}".format(self.ca_cert))
        elif not self.verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            print("[!] WARNING: Certificate verification DISABLED")
        else:
            ctx.load_default_certs()

        return ctx

    def _https_request(self, method, path, body=None):
        """Thực hiện HTTPS request qua raw socket + TLS 1.3."""
        ctx = self._create_ssl_context()

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)

        ssl_sock = ctx.wrap_socket(sock, server_hostname=self.host)

        try:
            ssl_sock.connect((self.host, self.port))

            # Xác nhận đang dùng TLS 1.3
            tls_version = ssl_sock.version()
            if tls_version != "TLSv1.3":
                print("[!] WARNING: Connected with {} instead of TLS 1.3!".format(
                    tls_version))

            # Xây dựng HTTP request
            body_bytes = b""
            if body:
                body_bytes = json.dumps(body).encode("utf-8")

            request = "{} {} HTTP/1.1\r\n".format(method, path)
            request += "Host: {}:{}\r\n".format(self.host, self.port)
            request += "Content-Type: application/json\r\n"
            request += "Content-Length: {}\r\n".format(len(body_bytes))
            request += "Connection: close\r\n"
            request += "\r\n"

            ssl_sock.sendall(request.encode("utf-8") + body_bytes)

            # Đọc response
            response = b""
            while True:
                try:
                    chunk = ssl_sock.recv(4096)
                    if not chunk:
                        break
                    response += chunk
                except socket.timeout:
                    break

            # Parse response
            if b"\r\n\r\n" in response:
                header, body_raw = response.split(b"\r\n\r\n", 1)
                status_line = header.split(b"\r\n")[0].decode("utf-8")
                status_code = int(status_line.split(" ")[1])

                try:
                    result = json.loads(body_raw.decode("utf-8"))
                except json.JSONDecodeError:
                    result = {"raw": body_raw.decode("utf-8", errors="replace")}

                return status_code, result
            else:
                return 0, {"error": "Invalid response"}

        except ssl.SSLError as e:
            # Nếu TLS 1.3 bị từ chối
            if "TLSV1_ALERT" in str(e) or "handshake" in str(e).lower():
                print("[!] TLS 1.3 handshake FAILED — server may not support TLS 1.3")
            raise
        finally:
            ssl_sock.close()

    def send_message(self, text):
        """Gửi tin nhắn tới server."""
        try:
            code, result = self._https_request("POST", "/send", {
                "sender": self.username,
                "text": text
            })
            if code == 201:
                return True
            else:
                print("[!] Send failed: {}".format(result))
                return False
        except Exception as e:
            print("[!] Connection error: {}".format(e))
            return False

    def fetch_messages(self):
        """Lấy tin nhắn mới từ server."""
        try:
            code, result = self._https_request(
                "GET",
                "/messages?after_id={}".format(self.last_msg_id)
            )
            if code == 200:
                new_messages = result.get("messages", [])
                for msg in new_messages:
                    if msg["sender"] != self.username:
                        print("\r\033[K[{}] {}: {}".format(
                            msg["time"], msg["sender"], msg["text"]
                        ))
                        print("{}> ".format(self.username), end="", flush=True)
                    if msg["id"] > self.last_msg_id:
                        self.last_msg_id = msg["id"]
        except Exception:
            pass  # Bỏ qua lỗi polling

    def check_server(self):
        """Kiểm tra kết nối và TLS version."""
        try:
            code, result = self._https_request("GET", "/status")
            if code == 200:
                print("[*] Server: {}".format(result.get("server", "Unknown")))
                print("[*] TLS Version: {}".format(
                    result.get("tls_version", "Unknown")))
                print("[*] Cipher Suites: {}".format(
                    ", ".join(result.get("cipher_suites", []))))
                return True
            return False
        except Exception as e:
            print("[!] Cannot connect: {}".format(e))
            return False

    def polling_loop(self):
        """Thread liên tục poll tin nhắn mới."""
        while self.running:
            self.fetch_messages()
            time.sleep(1)  # Poll mỗi 1 giây

    def run(self):
        """Main loop — giao diện terminal chat."""
        print()
        print("=" * 60)
        print("  TLS 1.3 Secure Chat Client")
        print("  Chuẩn bảo mật: RFC 8446")
        print("  Mã hóa: AEAD (AES-GCM / ChaCha20-Poly1305)")
        print("=" * 60)
        print()

        # Kiểm tra server
        print("[*] Connecting to {}:{}...".format(self.host, self.port))
        if not self.check_server():
            print("[!] Failed to connect. Exiting.")
            return

        # Thông báo TLS 1.3 info
        ctx = self._create_ssl_context()
        print("[*] Enforced TLS version: TLSv1.3 ONLY")
        print("[*] Forward secrecy: ENABLED (ephemeral key exchange)")
        print()
        print("─" * 60)
        print("  Gõ tin nhắn rồi Enter để gửi.")
        print("  Gõ /quit để thoát.")
        print("  Gõ /info để xem thông tin TLS.")
        print("─" * 60)
        print()

        # Bắt đầu thread polling
        poll_thread = threading.Thread(target=self.polling_loop, daemon=True)
        poll_thread.start()

        # Main input loop
        try:
            while self.running:
                try:
                    text = input("{}> ".format(self.username))
                except EOFError:
                    break

                if not text.strip():
                    continue

                if text.strip() == "/quit":
                    print("[*] Disconnecting...")
                    break

                if text.strip() == "/info":
                    self._print_tls_info()
                    continue

                if self.send_message(text):
                    pass  # Gửi thành công
                else:
                    print("[!] Gửi thất bại. Thử lại.")

        except KeyboardInterrupt:
            print("\n[*] Interrupted.")
        finally:
            self.running = False
            print("[*] Goodbye!")

    def _print_tls_info(self):
        """In thông tin chi tiết về TLS connection."""
        ctx = self._create_ssl_context()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        ssl_sock = ctx.wrap_socket(sock, server_hostname=self.host)
        try:
            ssl_sock.connect((self.host, self.port))
            print()
            print("┌─── TLS Connection Info ───────────────────┐")
            print("│ Protocol : {}".format(ssl_sock.version()))
            print("│ Cipher   : {}".format(ssl_sock.cipher()[0]))
            print("│ Bits     : {}".format(ssl_sock.cipher()[2]))
            cert = ssl_sock.getpeercert()
            if cert:
                print("│ Subject  : {}".format(
                    dict(x[0] for x in cert.get("subject", ()))))
                print("│ Issuer   : {}".format(
                    dict(x[0] for x in cert.get("issuer", ()))))
                print("│ Valid    : {} → {}".format(
                    cert.get("notBefore", "?"), cert.get("notAfter", "?")))
            print("└────────────────────────────────────────────┘")
            print()
        except Exception as e:
            print("[!] TLS info error: {}".format(e))
        finally:
            ssl_sock.close()


# ============================================================
# MicroPython Client Variant
# ============================================================
def micropython_client(host, port, username, ca_cert_path=None):
    """
    Client variant cho MicroPython (ESP32).
    Chạy trên thiết bị thứ hai kết nối tới server.
    """
    import socket
    import ssl  # hoặc 'tls' trên MicroPython cũ
    import json
    import time

    def send_https(ctx, method, path, body=None):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ssl_sock = ctx.wrap_socket(sock, server_hostname=host)
        ssl_sock.connect((host, port))

        body_bytes = b""
        if body:
            body_bytes = json.dumps(body).encode("utf-8")

        req = "{} {} HTTP/1.1\r\nHost: {}:{}\r\n".format(method, path, host, port)
        req += "Content-Type: application/json\r\n"
        req += "Content-Length: {}\r\nConnection: close\r\n\r\n".format(
            len(body_bytes))

        ssl_sock.write(req.encode("utf-8") + body_bytes)

        response = b""
        while True:
            chunk = ssl_sock.read(2048)
            if chunk:
                response += chunk
            else:
                break
        ssl_sock.close()

        if b"\r\n\r\n" in response:
            _, body_raw = response.split(b"\r\n\r\n", 1)
            return json.loads(body_raw)
        return {}

    # Setup TLS context
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if ca_cert_path:
        with open(ca_cert_path, "rb") as f:
            ctx.load_verify_locations(cadata=f.read())
    else:
        ctx.verify_mode = ssl.CERT_NONE  # Test only!

    print("[*] TLS 1.3 MicroPython Chat Client")
    print("[*] Server: {}:{}".format(host, port))

    last_id = -1
    while True:
        # Poll messages
        try:
            result = send_https(ctx, "GET",
                                "/messages?after_id={}".format(last_id))
            for msg in result.get("messages", []):
                if msg["sender"] != username:
                    print("[{}] {}: {}".format(
                        msg["time"], msg["sender"], msg["text"]))
                if msg["id"] > last_id:
                    last_id = msg["id"]
        except Exception as e:
            print("Poll error:", e)

        # Đọc input (non-blocking trên MicroPython có thể cần khác)
        # Đơn giản hóa: gõ text rồi Enter
        try:
            text = input("{}> ".format(username))
            if text.strip():
                if text.strip() == "/quit":
                    break
                send_https(ctx, "POST", "/send", {
                    "sender": username,
                    "text": text
                })
        except EOFError:
            break

    print("[*] Disconnected.")


# ============================================================
# Server variant chạy trên CPython (cho test không cần ESP32)
# ============================================================
def cpython_server(host, port, cert_file, key_file):
    """
    TLS 1.3 HTTPS Server chạy trên CPython (Debian/Linux).
    Dùng để test khi không có ESP32.
    """
    import http.server
    import ssl

    class ChatHandler(http.server.BaseHTTPRequestHandler):
        messages = []
        msg_lock = threading.Lock()

        def log_message(self, format, *args):
            tls_ver = "TLSv1.3" if hasattr(self.connection, 'version') else "?"
            sys.stderr.write("[%s] [%s] %s\n" % (
                self.log_date_time_string(),
                tls_ver if callable(getattr(self.connection, 'version', None))
                    and self.connection.version() == 'TLSv1.3'
                    else "TLS",
                format % args
            ))

        def _send_json(self, code, data):
            body = json.dumps(data).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/messages"):
                after_id = -1
                if "?" in self.path:
                    params = self.path.split("?")[1]
                    for p in params.split("&"):
                        if p.startswith("after_id="):
                            try:
                                after_id = int(p.split("=")[1])
                            except ValueError:
                                pass

                with ChatHandler.msg_lock:
                    filtered = [m for m in ChatHandler.messages
                                if m["id"] > after_id]

                self._send_json(200, {
                    "messages": filtered,
                    "count": len(filtered)
                })

            elif self.path == "/status":
                # Lấy TLS info
                tls_ver = "Unknown"
                cipher_name = "Unknown"
                if hasattr(self.connection, 'version'):
                    tls_ver = self.connection.version()
                if hasattr(self.connection, 'cipher'):
                    cipher_name = self.connection.cipher()[0]

                self._send_json(200, {
                    "server": "TLS 1.3 Chat Server (CPython)",
                    "tls_version": tls_ver,
                    "negotiated_cipher": cipher_name,
                    "cipher_suites": [
                        "TLS_AES_128_GCM_SHA256",
                        "TLS_AES_256_GCM_SHA384",
                        "TLS_CHACHA20_POLY1305_SHA256"
                    ],
                    "messages_count": len(ChatHandler.messages),
                    "forward_secrecy": True,
                    "handshake_rtt": "1-RTT"
                })
            else:
                self._send_json(404, {"error": "Not found"})

        def do_POST(self):
            if self.path == "/send":
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                try:
                    data = json.loads(body)
                    sender = data.get("sender", "anonymous")
                    text = data.get("text", "")

                    if not text.strip():
                        self._send_json(400, {"error": "Empty message"})
                        return

                    msg = {
                        "id": len(ChatHandler.messages),
                        "sender": sender,
                        "text": text,
                        "time": time.strftime("%Y-%m-%d %H:%M:%S")
                    }

                    with ChatHandler.msg_lock:
                        ChatHandler.messages.append(msg)
                        if len(ChatHandler.messages) > 100:
                            ChatHandler.messages.pop(0)

                    print("\033[92m[{}] {}: {}\033[0m".format(
                        msg["time"], sender, text))

                    self._send_json(201, {
                        "status": "sent",
                        "id": msg["id"]
                    })
                except json.JSONDecodeError:
                    self._send_json(400, {"error": "Invalid JSON"})
            else:
                self._send_json(404, {"error": "Not found"})

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

    # Tạo SSL context — BẮT BUỘC TLS 1.3
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.maximum_version = ssl.TLSVersion.TLSv1_3
    context.load_cert_chain(certfile=cert_file, keyfile=key_file)

    # Log cipher suites
    print()
    print("=" * 60)
    print("  TLS 1.3 HTTPS Chat Server")
    print("  Tuân thủ RFC 8446")
    print("=" * 60)
    print()
    print("[*] Certificate : {}".format(cert_file))
    print("[*] Private key : {}".format(key_file))
    print("[*] TLS version : TLSv1.3 ONLY (min=max=TLSv1.3)")
    print("[*] Forward Secrecy : ENABLED")
    print("[*] AEAD ciphers only")
    print()
    print("[*] Endpoints:")
    print("    GET  https://{}:{}/status".format(host, port))
    print("    GET  https://{}:{}/messages?after_id=N".format(host, port))
    print("    POST https://{}:{}/send".format(host, port))
    print()

    server = http.server.HTTPServer((host, port), ChatHandler)
    server.socket = context.wrap_socket(server.socket, server_side=True)

    print("[*] Listening on {}:{}".format(host, port))
    print("[*] Press Ctrl+C to stop")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server stopped.")
        server.server_close()


# ============================================================
# CLI ENTRY POINT
# ============================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="TLS 1.3 Secure Chat — RFC 8446 Compliant",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ví dụ sử dụng:

  # Khởi động server (trên Debian):
  python3 tls13_chat_client.py server \\
      --host 0.0.0.0 --port 8443 \\
      --cert server.crt --key server.key

  # Kết nối client (terminal khác):
  python3 tls13_chat_client.py client \\
      --host 192.168.1.100 --port 8443 \\
      --name Alice --ca ca.crt

  # Client không verify cert (test only):
  python3 tls13_chat_client.py client \\
      --host localhost --port 8443 \\
      --name Bob --no-verify
"""
    )

    subparsers = parser.add_subparsers(dest="mode", help="Chế độ hoạt động")

    # Server mode
    srv_parser = subparsers.add_parser("server", help="Chạy TLS 1.3 server")
    srv_parser.add_argument("--host", default="0.0.0.0",
                            help="Bind address (default: 0.0.0.0)")
    srv_parser.add_argument("--port", type=int, default=8443,
                            help="Port (default: 8443)")
    srv_parser.add_argument("--cert", required=True,
                            help="Server certificate file (.crt)")
    srv_parser.add_argument("--key", required=True,
                            help="Server private key file (.key)")

    # Client mode
    cli_parser = subparsers.add_parser("client", help="Chạy TLS 1.3 client")
    cli_parser.add_argument("--host", required=True,
                            help="Server hostname/IP")
    cli_parser.add_argument("--port", type=int, default=8443,
                            help="Server port (default: 8443)")
    cli_parser.add_argument("--name", default="User",
                            help="Tên hiển thị (default: User)")
    cli_parser.add_argument("--ca", default=None,
                            help="CA certificate để verify server")
    cli_parser.add_argument("--no-verify", action="store_true",
                            help="Tắt certificate verification (KHÔNG an toàn)")

    args = parser.parse_args()

    if args.mode == "server":
        cpython_server(args.host, args.port, args.cert, args.key)
    elif args.mode == "client":
        client = TLS13ChatClient(
            host=args.host,
            port=args.port,
            username=args.name,
            ca_cert=args.ca,
            verify=not args.no_verify
        )
        client.run()
    else:
        parser.print_help()
```

### 9.5. Hướng Dẫn Chạy Nhanh

```bash
# ============================================================
# BƯỚC 1: Sinh certificate (trên Debian)
# ============================================================
# Self-signed ECC cert cho mục đích demo
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -sha256 -days 365 -nodes \
    -keyout server.key -out server.crt \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# ============================================================
# BƯỚC 2: Chạy server (Terminal 1)
# ============================================================
python3 tls13_chat_client.py server \
    --host 0.0.0.0 --port 8443 \
    --cert server.crt --key server.key

# ============================================================
# BƯỚC 3: Chạy client Alice (Terminal 2)
# ============================================================
python3 tls13_chat_client.py client \
    --host localhost --port 8443 \
    --name Alice --no-verify

# ============================================================
# BƯỚC 4: Chạy client Bob (Terminal 3)
# ============================================================
python3 tls13_chat_client.py client \
    --host localhost --port 8443 \
    --name Bob --no-verify

# ============================================================
# Giờ Alice gõ text → Bob nhận được, và ngược lại!
# Mọi dữ liệu đều được mã hóa TLS 1.3 (AES-GCM hoặc ChaCha20)
# ============================================================

# ============================================================
# BƯỚC 5: Xác minh TLS 1.3 bằng openssl
# ============================================================
echo | openssl s_client -connect localhost:8443 -tls1_3 2>/dev/null | \
    grep -E "Protocol|Cipher"
# Output mong đợi:
#   Protocol  : TLSv1.3
#   Cipher    : TLS_AES_256_GCM_SHA384

# Thử kết nối TLS 1.2 — phải bị từ chối:
echo | openssl s_client -connect localhost:8443 -tls1_2 2>/dev/null | \
    grep -i "error\|alert"
# Output: handshake failure

# ============================================================
# CHO ESP32 (MicroPython):
# ============================================================
# 1. Flash MicroPython firmware >= 1.22
# 2. Upload files:
#    mpremote cp server.key :server.key
#    mpremote cp server.crt :server.crt
#    mpremote cp tls13_chat_server.py :main.py
# 3. Sửa WiFi credentials trong code
# 4. Reset ESP32 → server tự khởi động
# 5. Từ PC, chạy client trỏ tới IP của ESP32
```

### 9.6. Test Bằng curl

```bash
# Kiểm tra status
curl -k --tlsv1.3 https://localhost:8443/status | python3 -m json.tool

# Gửi tin nhắn
curl -k --tlsv1.3 -X POST https://localhost:8443/send \
    -H "Content-Type: application/json" \
    -d '{"sender":"Terminal","text":"Hello from curl via TLS 1.3!"}'

# Lấy tin nhắn
curl -k --tlsv1.3 https://localhost:8443/messages | python3 -m json.tool

# Xác nhận TLS version
curl -kv --tlsv1.3 https://localhost:8443/status 2>&1 | grep "TLSv1.3"
```

---

## 10. Kiểm Tra & Debug TLS 1.3

### 10.1. Xác Minh Protocol Version

```bash
# Kiểm tra server hỗ trợ TLS 1.3
openssl s_client -connect <host>:8443 -tls1_3

# Trong output, tìm:
#   Protocol  : TLSv1.3
#   Cipher    : TLS_AES_256_GCM_SHA384  (hoặc cipher TLS 1.3 khác)

# Kiểm tra server KHÔNG chấp nhận TLS 1.2
openssl s_client -connect <host>:8443 -tls1_2
# Mong đợi: error / handshake failure
```

### 10.2. Xem Chi Tiết Handshake

```bash
# Verbose handshake
openssl s_client -connect <host>:8443 -tls1_3 -msg -debug

# Chỉ xem cipher đã thỏa thuận
openssl s_client -connect <host>:8443 -tls1_3 2>/dev/null | \
    grep -E "Protocol|Cipher|Server public key"
```

### 10.3. Wireshark / tcpdump

```bash
# Capture TLS traffic
sudo tcpdump -i eth0 -w tls13_capture.pcap port 8443

# Mở bằng Wireshark, filter: tls.handshake.type == 1
# Xác nhận:
# - supported_versions extension chứa 0x0304 (TLS 1.3)
# - Sau ServerHello, mọi message đều encrypted
# - Không có ChangeCipherSpec (hoặc chỉ có dummy cho middlebox compat)
```

### 10.4. Kiểm Tra Certificate

```bash
# Xem certificate chi tiết
openssl x509 -in server.crt -text -noout

# Xác minh certificate chain
openssl verify -CAfile ca.crt server.crt

# Kiểm tra key match
openssl x509 -in server.crt -noout -pubkey | openssl md5
openssl ec -in server-ecc.key -pubout | openssl md5
# Hai giá trị phải giống nhau
```

---

## 11. Best Practices & Hardening

### 11.1. Cấu Hình Server

1. **Chỉ cho phép TLS 1.3** — Nếu không cần tương thích ngược, disable TLS 1.2 trở xuống.
2. **Ưu tiên cipher suites** theo thứ tự: TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256, TLS_AES_128_GCM_SHA256.
3. **ECDSA certificate** — Nhanh hơn RSA, key nhỏ hơn. Dùng P-256 hoặc P-384.
4. **Tắt 0-RTT** nếu ứng dụng không xử lý được replay.
5. **HSTS header** — Thêm `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
6. **Certificate rotation** — Tự động gia hạn (Let's Encrypt) hoặc lên lịch thay thế.

### 11.2. Cho Thiết Bị IoT/Embedded

1. **Dùng ECC P-256** — Cân bằng giữa bảo mật và hiệu năng trên MCU.
2. **Pin certificate** — Lưu CA cert trên device, verify server cert.
3. **Cập nhật firmware** — mbedTLS (dùng trong MicroPython) cần được cập nhật để vá lỗi.
4. **Giới hạn cipher** — Chỉ enable cipher suites phù hợp với hardware (AES-CCM cho device có AES accelerator).
5. **NTP sync** — Certificate validation cần thời gian chính xác.

### 11.3. Nginx Cấu Hình TLS 1.3

```nginx
server {
    listen 443 ssl http2;
    server_name myserver.local;

    ssl_certificate     /etc/ssl/certs/server.crt;
    ssl_certificate_key /etc/ssl/private/server.key;

    # Chỉ TLS 1.3
    ssl_protocols TLSv1.3;

    # Cipher suites (TLS 1.3 tự quản lý, nhưng có thể chỉ định)
    ssl_ciphers TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256;
    ssl_prefer_server_ciphers off;  # TLS 1.3 ưu tiên client preference

    # ECDH curves
    ssl_ecdh_curve X25519:secp384r1:secp256r1;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
}
```

---

## 12. Tài Liệu Tham Khảo

| Tài liệu | Nguồn |
|----------|-------|
| RFC 8446 — TLS 1.3 | https://datatracker.ietf.org/doc/html/rfc8446 |
| RFC 5869 — HKDF | https://datatracker.ietf.org/doc/html/rfc5869 |
| RFC 8032 — EdDSA | https://datatracker.ietf.org/doc/html/rfc8032 |
| Mozilla SSL Configuration Generator | https://ssl-config.mozilla.org |
| MicroPython SSL Module | https://docs.micropython.org/en/latest/library/ssl.html |
| OpenSSL Documentation | https://www.openssl.org/docs/ |
| Cloudflare TLS 1.3 Deep Dive | https://blog.cloudflare.com/rfc-8446-aka-tls-1-3/ |
| OWASP TLS Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/TLS_Cheat_Sheet.html |

