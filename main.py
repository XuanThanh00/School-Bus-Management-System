#!/usr/bin/env python3
"""
Hệ thống điểm danh học sinh — Raspberry Pi 5
Chạy: python main.py
"""
from attendance import AttendanceSystem

if __name__ == "__main__":
    system = AttendanceSystem()
    system.setup()
    system.run()
