VENV   := bus-venv
PYTHON := $(VENV)/bin/python3
PIP    := $(VENV)/bin/pip

.PHONY: all venv install install-system install-python download-models check run run-debug install-service uninstall-service help

# ── Default target ─────────────────────────────────────────
all: install download-models check

# ══════════════════════════════════════════════════════════
# 1. TẠO VIRTUAL ENVIRONMENT
# ══════════════════════════════════════════════════════════
venv:
	@if [ ! -d $(VENV) ]; then \
		echo "==> Tạo virtualenv (--system-site-packages)..."; \
		python3 -m venv --system-site-packages $(VENV); \
		echo "==> venv OK"; \
	else \
		echo "==> venv đã tồn tại — bỏ qua"; \
	fi

# ══════════════════════════════════════════════════════════
# 2. CÀI ĐẶT GÓI HỆ THỐNG (apt)
# ══════════════════════════════════════════════════════════
install-system:
	@echo "==> [1/3] Cài gói hệ thống (apt)..."
	sudo apt-get update -qq
	sudo apt-get install -y \
		python3-pip \
		python3-venv \
		python3-picamera2 \
		python3-libcamera \
		python3-opencv \
		libgpiod-dev \
		python3-gpiod \
		libsdl2-dev \
		libsdl2-image-dev \
		libsdl2-mixer-dev \
		libsdl2-ttf-dev \
		libfreetype6-dev \
		libportmidi-dev \
		build-essential \
		cmake \
		libopenblas-dev \
		liblapack-dev \
		libjpeg-dev \
		libpng-dev
	@echo "==> [1/3] DONE"

# ══════════════════════════════════════════════════════════
# 3. CÀI ĐẶT GÓI PYTHON (pip vào venv)
# ══════════════════════════════════════════════════════════
install-python: venv
	@echo "==> [2/3] Cài gói Python vào venv..."
	$(PIP) install --upgrade pip
	$(PIP) install \
		pygame \
		pyserial \
		firebase-admin \
		onnxruntime \
		insightface
	@# Cài numpy sau cùng — insightface có thể kéo numpy mới hơn khi cài
	$(PIP) install "numpy==1.26.4"
	@echo "==> [2/3] DONE"

# ══════════════════════════════════════════════════════════
# FULL INSTALL
# ══════════════════════════════════════════════════════════
install: install-system install-python

# ══════════════════════════════════════════════════════════
# 4. DOWNLOAD MODEL ONNX
# ══════════════════════════════════════════════════════════
download-models: venv
	@echo "==> [3/3] Kiểm tra và tải model ONNX..."

	@# YuNet face detector
	@if [ ! -f face_detection_yunet_2023mar.onnx ]; then \
		echo "  Đang tải YuNet (~350 KB)..."; \
		wget -q --show-progress \
			"https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"; \
	else \
		echo "  YuNet: OK (đã có)"; \
	fi

	@# Buffalo_l W600K — insightface tự download nếu chưa có
	@if [ ! -f "$(HOME)/.insightface/models/buffalo_l/w600k_r50.onnx" ]; then \
		echo "  Đang tải buffalo_l W600K (~174 MB) qua insightface..."; \
		$(PYTHON) -c "\
from insightface.app import FaceAnalysis; \
app = FaceAnalysis(name='buffalo_l', root='$(HOME)/.insightface'); \
app.prepare(ctx_id=-1); \
print('  buffalo_l: OK')"; \
	else \
		echo "  buffalo_l W600K: OK (đã có)"; \
	fi

	@echo "==> [3/3] DONE"

# ══════════════════════════════════════════════════════════
# KIỂM TRA SAU CÀI ĐẶT
# ══════════════════════════════════════════════════════════
check: venv
	@echo ""
	@echo "==> Kiểm tra các thư viện..."
	@$(PYTHON) -c "import cv2;           print('  cv2            OK  -', cv2.__version__)"
	@$(PYTHON) -c "import numpy;         print('  numpy          OK  -', numpy.__version__)"
	@$(PYTHON) -c "import pygame;        print('  pygame         OK  -', pygame.__version__)"
	@$(PYTHON) -c "import serial;        print('  pyserial       OK  -', serial.__version__)"
	@$(PYTHON) -c "import gpiod;         print('  gpiod          OK  -', gpiod.__version__)"
	@$(PYTHON) -c "import firebase_admin; print('  firebase-admin OK')"
	@$(PYTHON) -c "import onnxruntime;   print('  onnxruntime    OK  -', onnxruntime.__version__)"
	@$(PYTHON) -c "import insightface;   print('  insightface    OK  -', insightface.__version__)"
	@$(PYTHON) -c "from picamera2 import Picamera2; print('  picamera2      OK')" 2>/dev/null \
		|| echo "  picamera2      WARN - chỉ chạy được trên Pi thật"
	@echo ""
	@# Kiểm tra file credentials
	@if [ -f credentials.json ]; then \
		echo "  credentials.json      OK"; \
	else \
		echo "  credentials.json      MISSING  <-- cần copy vào thư mục này!"; \
	fi
	@# Kiểm tra model YuNet
	@if [ -f face_detection_yunet_2023mar.onnx ]; then \
		echo "  YuNet model           OK"; \
	else \
		echo "  YuNet model           MISSING  <-- chạy: make download-models"; \
	fi
	@# Kiểm tra model buffalo_l
	@if [ -f "$(HOME)/.insightface/models/buffalo_l/w600k_r50.onnx" ]; then \
		echo "  buffalo_l model       OK"; \
	else \
		echo "  buffalo_l model       MISSING  <-- chạy: make download-models"; \
	fi
	@echo ""

# ══════════════════════════════════════════════════════════
# CHẠY HỆ THỐNG
# ══════════════════════════════════════════════════════════
run: venv
	$(PYTHON) main.py

run-debug: venv
	PYTHONFAULTHANDLER=1 $(PYTHON) -u main.py 2>&1 | tee run.log

# ══════════════════════════════════════════════════════════
# SYSTEMD SERVICE — tự chạy khi Pi boot
# ══════════════════════════════════════════════════════════
install-service:
	@echo "==> Cài bus_system.service vào systemd..."
	sudo cp bus_system.service /etc/systemd/system/
	sudo systemctl daemon-reload
	sudo systemctl enable bus_system.service
	sudo systemctl start bus_system.service
	@echo "==> Done. Trạng thái:"
	@sudo systemctl status bus_system.service --no-pager

uninstall-service:
	@echo "==> Gỡ bus_system.service..."
	sudo systemctl stop bus_system.service || true
	sudo systemctl disable bus_system.service || true
	sudo rm -f /etc/systemd/system/bus_system.service
	sudo systemctl daemon-reload
	@echo "==> Done"

# ══════════════════════════════════════════════════════════
# HELP
# ══════════════════════════════════════════════════════════
help:
	@echo ""
	@echo "Makefile — Hệ thống điểm danh xe buýt (Pi 5)"
	@echo "────────────────────────────────────────────"
	@echo "  make install           Cài đầy đủ (apt + tạo venv + pip)"
	@echo "  make install-system    Chỉ cài gói apt"
	@echo "  make install-python    Tạo venv + cài pip"
	@echo "  make download-models   Tải model ONNX (YuNet + buffalo_l)"
	@echo "  make check             Kiểm tra thư viện và file cần thiết"
	@echo "  make run               Chạy hệ thống (dùng bus-venv/bin/python3)"
	@echo "  make run-debug         Chạy + ghi log ra run.log"
	@echo "  make install-service   Cài + enable systemd service (tự chạy khi boot)"
	@echo "  make uninstall-service Gỡ systemd service"
	@echo ""
	@echo "Venv: $(VENV)/ (--system-site-packages)"
	@echo "  → picamera2, opencv, gpiod dùng từ apt"
	@echo "  → pygame, firebase-admin, onnxruntime, insightface cài trong venv"
	@echo ""
