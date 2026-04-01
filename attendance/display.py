# ══════════════════════════════════════════════════════════
# attendance/display.py
# Pygame UI cho màn hình xe buýt
# Layout:
#   Trái  : Camera feed + bounding box + score
#   Phải  : Card FACE (trên) + Card RFID (dưới) + Counter + Log
#   Header: Tên hệ thống + giờ
#   Footer: GPS + tuyến xe
# ══════════════════════════════════════════════════════════

import pygame
import numpy as np
import cv2
import time
import os

# ── Màu sắc ────────────────────────────────────────────────
BG_MAIN       = (13,  13,  30)
BG_HEADER     = (15,  52,  96)
BG_FOOTER     = (10,  10,  10)
BG_CARD       = (13,  17,  23)
BG_CARD_OK    = (10,  42,  26)
BG_CARD_WAIT  = (26,  26,  10)
BG_CARD_SCAN  = (13,  20,  40)
BG_CARD_RFID  = (10,  26,  40)
BG_MASTER     = (26,  10,  10)

COLOR_WHITE   = (224, 224, 224)
COLOR_GRAY    = (96,  112, 128)
COLOR_GREEN   = (0,   204, 85)
COLOR_YELLOW  = (255, 204, 0)
COLOR_RED     = (255, 80,  50)
COLOR_BLUE    = (55,  138, 221)
COLOR_CYAN    = (0,   200, 220)
COLOR_MASTER  = (255, 102, 68)
COLOR_DIM     = (48,  56,  64)
COLOR_HEADER  = (160, 180, 210)

BORDER_OK     = (26,  92,  48)
BORDER_WAIT   = (74,  74,  16)
BORDER_MASTER = (92,  26,  26)
BORDER_SCAN   = (30,  60,  100)
BORDER_RFID   = (20,  70,  110)

# ── Layout ─────────────────────────────────────────────────
DISPLAY_W  = 800
DISPLAY_H  = 480
HEADER_H   = 36
FOOTER_H   = 24
CAM_W      = 480
CAM_H      = DISPLAY_H - HEADER_H - FOOTER_H   # 420
PANEL_X    = CAM_W
PANEL_W    = DISPLAY_W - CAM_W                  # 320
FPS_CAP    = 30


class BusDisplay:
    """
    Pygame UI cho hệ thống điểm danh xe buýt.
    Hiện đồng thời:
      - Card FACE: kết quả nhận diện khuôn mặt
      - Card RFID: thẻ vừa quẹt
      - Bounding box + score trực tiếp trên camera feed
    """

    def __init__(self, route: str = "TUYEN 01", fullscreen: bool = False):
        if fullscreen or not os.environ.get("DISPLAY"):
            os.environ.setdefault("SDL_VIDEODRIVER", "fbcon")
            os.environ.setdefault("SDL_FBDEV", "/dev/fb0")

        pygame.init()
        pygame.mouse.set_visible(False)

        flags = pygame.FULLSCREEN if fullscreen else 0
        try:
            self._screen = pygame.display.set_mode((DISPLAY_W, DISPLAY_H), flags)
        except Exception:
            os.environ["SDL_VIDEODRIVER"] = "x11"
            pygame.quit()
            pygame.init()
            self._screen = pygame.display.set_mode((DISPLAY_W, DISPLAY_H))

        pygame.display.set_caption("Diem Danh Xe Buyt")
        self._clock = pygame.time.Clock()
        self._route = route

        # Fonts
        self._font_xl  = pygame.font.SysFont("dejavusansmono", 30, bold=True)
        self._font_lg  = pygame.font.SysFont("dejavusansmono", 18, bold=True)
        self._font_md  = pygame.font.SysFont("dejavusansmono", 14)
        self._font_sm  = pygame.font.SysFont("dejavusansmono", 11)

        # State
        self._cam_surface    = None
        self._face_status    = "WAITING"
        self._face_name      = ""
        self._face_class     = ""
        self._face_score     = 0.0
        self._face_ts        = ""
        self._rfid_name      = ""
        self._rfid_class     = ""
        self._rfid_uid       = ""
        self._rfid_ts        = 0.0    # timestamp lần quẹt cuối
        self._attendance     = 0
        self._total          = 0
        self._fps            = 0.0
        self._inf_ms         = 0
        self._gps_str        = "GPS: --"
        self._master_sec     = 0
        self._rfid_ok        = True
        self._cam_ok         = True
        self._last_log: list = []

    # ── Public API ─────────────────────────────────────────

    def update(self,
               frame_bgr,
               face_status:   str   = "WAITING",
               face_name:     str   = "",
               face_class:    str   = "",
               face_score:    float = 0.0,
               face_ts:       str   = "",
               rfid_name:     str   = "",
               rfid_class:    str   = "",
               rfid_uid:      str   = "",
               rfid_ts:       float = 0.0,
               attendance:    int   = 0,
               total:         int   = 0,
               fps:           float = 0.0,
               inf_ms:        int   = 0,
               gps_str:       str   = "",
               master_sec:    int   = 0,
               rfid_ok:       bool  = True,
               cam_ok:        bool  = True,
               last_log:      list  = None) -> bool:
        """Vẽ 1 frame. Trả về False nếu người dùng thoát."""
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False
            if event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_q, pygame.K_ESCAPE):
                    return False

        self._face_status = face_status
        self._face_name   = face_name
        self._face_class  = face_class
        self._face_score  = face_score
        self._face_ts     = face_ts
        self._rfid_name   = rfid_name
        self._rfid_class  = rfid_class
        self._rfid_uid    = rfid_uid
        self._rfid_ts     = rfid_ts
        self._attendance  = attendance
        self._total       = total
        self._fps         = fps
        self._inf_ms      = inf_ms
        self._gps_str     = gps_str or "GPS: --"
        self._master_sec  = master_sec
        self._rfid_ok     = rfid_ok
        self._cam_ok      = cam_ok
        if last_log is not None:
            self._last_log = last_log

        # Camera → pygame surface
        if frame_bgr is not None:
            rgb  = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            rgb  = cv2.resize(rgb, (CAM_W, CAM_H))
            self._cam_surface = pygame.surfarray.make_surface(rgb.swapaxes(0, 1))

        self._render()
        self._clock.tick(FPS_CAP)
        return True

    def quit(self):
        pygame.quit()

    # ── Render ─────────────────────────────────────────────

    def _render(self):
        s = self._screen
        s.fill(BG_MAIN)
        self._draw_header()
        self._draw_camera()
        self._draw_right_panel()
        self._draw_footer()
        pygame.display.flip()

    def _draw_header(self):
        s = self._screen
        pygame.draw.rect(s, BG_HEADER, (0, 0, DISPLAY_W, HEADER_H))
        title = self._font_md.render("HE THONG DIEM DANH XE BUYT", True, COLOR_WHITE)
        s.blit(title, (12, (HEADER_H - title.get_height()) // 2))
        ts = time.strftime("%H:%M:%S")
        t  = self._font_md.render(ts, True, COLOR_HEADER)
        s.blit(t, (DISPLAY_W - t.get_width() - 12, (HEADER_H - t.get_height()) // 2))

    def _draw_camera(self):
        s   = self._screen
        top = HEADER_H

        pygame.draw.rect(s, (0, 0, 0), (0, top, CAM_W, CAM_H))

        if self._cam_surface:
            s.blit(self._cam_surface, (0, top))
        else:
            txt = self._font_md.render("NO CAMERA", True, COLOR_DIM)
            s.blit(txt, (CAM_W//2 - txt.get_width()//2, top + CAM_H//2))

        # Master mode banner
        if self._face_status == "MASTER" and self._master_sec > 0:
            overlay = pygame.Surface((CAM_W, 36), pygame.SRCALPHA)
            overlay.fill((0, 160, 60, 210))
            s.blit(overlay, (0, top))
            txt = self._font_lg.render(
                f"[MASTER KEY] NHIN VAO CAMERA... {self._master_sec}s",
                True, (255, 255, 255))
            s.blit(txt, (8, top + (36 - txt.get_height()) // 2))

        # FPS / Inf
        info = self._font_sm.render(
            f"FPS:{self._fps:.0f} Inf:{self._inf_ms}ms", True, COLOR_DIM)
        s.blit(info, (6, top + CAM_H - info.get_height() - 4))

    def _draw_right_panel(self):
        s   = self._screen
        x   = PANEL_X
        top = HEADER_H
        w   = PANEL_W
        pad = 10
        y   = top

        # ── Card FACE ──────────────────────────────────────
        face_h = 118
        bg, bc, lbl_color, lbl_text = self._face_card_style()
        self._draw_card(x, y, w, face_h, bg, bc)

        # Label
        lbl = self._font_sm.render(lbl_text, True, lbl_color)
        s.blit(lbl, (x + pad, y + 8))

        # Dot indicator
        pygame.draw.circle(s, lbl_color, (x + pad - 6 + lbl.get_width() + 14, y + 14), 4)

        # Tên
        name = (self._face_name[:16] if self._face_name else "---")
        nm = self._font_lg.render(name, True, COLOR_WHITE)
        s.blit(nm, (x + pad, y + 26))

        # Lớp + ts
        if self._face_class:
            sub = f"Lop {self._face_class}"
            if self._face_ts:
                sub += f"  {self._face_ts}"
            st = self._font_sm.render(sub, True, COLOR_GRAY)
            s.blit(st, (x + pad, y + 52))

        # Score
        if self._face_score > 0:
            sc_color = COLOR_GREEN if self._face_status == "OK" else COLOR_YELLOW
            sc = self._font_sm.render(f"Score: {self._face_score:.2f}", True, sc_color)
            s.blit(sc, (x + pad, y + 70))

        # UID khi OK
        if self._face_status == "OK" and self._rfid_uid:
            uid = self._font_sm.render(f"UID: {self._rfid_uid}", True, COLOR_DIM)
            s.blit(uid, (x + pad, y + 88))

        y += face_h + 6

        # ── Card RFID ──────────────────────────────────────
        rfid_h = 80
        rfid_active = bool(self._rfid_name) and (time.time() - self._rfid_ts < 10)
        rfid_bg  = BG_CARD_RFID  if rfid_active else BG_CARD
        rfid_bc  = BORDER_RFID   if rfid_active else (30, 40, 50)
        rfid_lbl_color = COLOR_CYAN if rfid_active else COLOR_DIM

        self._draw_card(x, y, w, rfid_h, rfid_bg, rfid_bc)

        rfid_label = "RFID: " + (self._rfid_name[:14] if rfid_active else "---")
        rl = self._font_sm.render("THE RFID", True, rfid_lbl_color)
        s.blit(rl, (x + pad, y + 8))

        rn = self._font_lg.render(
            self._rfid_name[:16] if rfid_active else "---",
            True, COLOR_WHITE if rfid_active else COLOR_DIM)
        s.blit(rn, (x + pad, y + 26))

        if rfid_active and self._rfid_class:
            rc = self._font_sm.render(
                f"Lop {self._rfid_class}  UID: {self._rfid_uid}", True, COLOR_GRAY)
            s.blit(rc, (x + pad, y + 52))

        y += rfid_h + 6

        # ── Counter ────────────────────────────────────────
        cnt_h = 72
        self._draw_card(x, y, w, cnt_h, BG_CARD_SCAN, BORDER_SCAN)
        lbl2 = self._font_sm.render("DIEM DANH HOC SINH", True, COLOR_DIM)
        s.blit(lbl2, (x + pad, y + 8))

        num = self._font_xl.render(str(self._attendance), True, COLOR_WHITE)
        s.blit(num, (x + pad, y + 24))
        tot = self._font_lg.render(f"/ {self._total}", True, COLOR_GRAY)
        s.blit(tot, (x + pad + num.get_width() + 6, y + 30))

        # Progress bar
        bar_y = y + cnt_h - 12
        bw    = w - pad * 2
        pygame.draw.rect(s, (30, 42, 58), (x+pad, bar_y, bw, 5), border_radius=2)
        if self._total > 0 and self._attendance > 0:
            fill = max(4, int(bw * self._attendance / self._total))
            pygame.draw.rect(s, COLOR_BLUE, (x+pad, bar_y, fill, 5), border_radius=2)

        y += cnt_h + 6

        # ── Recent log ─────────────────────────────────────
        log_h = DISPLAY_H - FOOTER_H - y
        if log_h > 20:
            self._draw_card(x, y, w, log_h, BG_CARD, (30, 40, 50))
            hdr = self._font_sm.render("LICH SU DIEM DANH", True, COLOR_DIM)
            s.blit(hdr, (x + pad, y + 8))
            yy = y + 24
            for entry in reversed(self._last_log[-4:]):
                name, ts, is_master = entry
                color = COLOR_MASTER if is_master else COLOR_GREEN
                tag   = "[M]" if is_master else "   "
                row   = self._font_sm.render(
                    f"{tag} {ts} {name[:13]}", True, color)
                if yy + row.get_height() > y + log_h - 4:
                    break
                s.blit(row, (x + pad, yy))
                yy += row.get_height() + 3

    def _draw_footer(self):
        s = self._screen
        fy = DISPLAY_H - FOOTER_H
        pygame.draw.rect(s, BG_FOOTER, (0, fy, DISPLAY_W, FOOTER_H))
        gps = self._font_sm.render(self._gps_str, True, COLOR_DIM)
        s.blit(gps, (12, fy + (FOOTER_H - gps.get_height())//2))
        rt  = self._font_sm.render(self._route, True, COLOR_DIM)
        s.blit(rt, (DISPLAY_W - rt.get_width() - 12,
                    fy + (FOOTER_H - rt.get_height())//2))

    # ── Helpers ────────────────────────────────────────────

    def _draw_card(self, x, y, w, h, bg, border):
        pygame.draw.rect(self._screen, bg,     (x, y, w, h), border_radius=6)
        pygame.draw.rect(self._screen, border, (x, y, w, h), width=1, border_radius=6)

    def _face_card_style(self):
        s = self._face_status
        if s == "OK":
            return BG_CARD_OK,   BORDER_OK,     COLOR_GREEN,  "NHAN DIEN THANH CONG"
        if s == "WAIT_RFID":
            return BG_CARD_WAIT, BORDER_WAIT,   COLOR_YELLOW, "CHO QUET THE RFID"
        if s == "MASTER":
            return BG_MASTER,    BORDER_MASTER, COLOR_MASTER, "MASTER KEY ACTIVE"
        if s == "SCANNING":
            return BG_CARD_SCAN, BORDER_SCAN,   COLOR_BLUE,   "DANG QUET KHUON MAT"
        return BG_CARD, (30, 40, 50), COLOR_DIM, "MOI HOCSINH QUET THE"
