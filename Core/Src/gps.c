/*
 * gps.c
 *
 *  Created on: Apr 7, 2026
 *      Author: Thanh
 */


#include "gps.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

/* ════════════════════════════════
   INTERNAL HELPERS
   ════════════════════════════════ */

static bool _verify_checksum(char *s) {
    char *start = strchr(s, '$');
    char *star  = strchr(s, '*');
    if (!start || !star || star <= start + 1) return false;

    uint8_t calc = 0;
    for (char *p = start + 1; p < star; p++) calc ^= (uint8_t)*p;

    uint8_t recv = (uint8_t)strtol(star + 1, NULL, 16);
    return calc == recv;
}

/* DDMM.mmmmm → decimal degrees */
static float _to_decimal(const char *raw, char hemi) {
    if (!raw || raw[0] == '\0') return 0.0f;
    float  val  = strtof(raw, NULL);
    int    deg  = (int)(val / 100);
    float  mins = val - deg * 100;
    float  res  = deg + mins / 60.0f;
    if (hemi == 'S' || hemi == 'W') res = -res;
    return res;
}

/* Lấy field thứ n trong chuỗi NMEA */
static void _field(const char *s, uint8_t n, char *out, uint8_t max) {
    const char *p = s;
    for (uint8_t i = 0; i < n; i++) {
        p = strchr(p, ',');
        if (!p) { out[0] = '\0'; return; }
        p++;
    }
    uint8_t i = 0;
    while (*p && *p != ',' && *p != '*' && i < max - 1)
        out[i++] = *p++;
    out[i] = '\0';
}

/* ── Parse $GPGGA / $GNGGA ── */
static void _parse_GGA(GPS_Handle *h, char *s) {
    char f[20];

    _field(s, 1, f, sizeof(f));
    if (f[0]) {
        h->data.hour   = (f[0]-'0')*10 + (f[1]-'0');
        h->data.minute = (f[2]-'0')*10 + (f[3]-'0');
        h->data.second = (f[4]-'0')*10 + (f[5]-'0');
    }

    char lat[16], lat_h[4], lon[16], lon_h[4];
    _field(s, 2, lat,   sizeof(lat));
    _field(s, 3, lat_h, sizeof(lat_h));
    _field(s, 4, lon,   sizeof(lon));
    _field(s, 5, lon_h, sizeof(lon_h));
    h->data.latitude  = _to_decimal(lat,  lat_h[0]);
    h->data.longitude = _to_decimal(lon,  lon_h[0]);

    _field(s, 6, f, sizeof(f));
    h->data.fix_valid = (f[0] != '\0' && f[0] != '0');

    _field(s, 7, f, sizeof(f));
    h->data.satellites = (uint8_t)atoi(f);

    _field(s, 8, f, sizeof(f));
    h->data.hdop = strtof(f, NULL);

    _field(s, 9, f, sizeof(f));
    h->data.altitude = strtof(f, NULL);

    h->data.last_update_tick = HAL_GetTick();
}

/* ── Parse $GPRMC / $GNRMC ── */
static void _parse_RMC(GPS_Handle *h, char *s) {
    char f[20];
    _field(s, 2, f, sizeof(f));
    if (f[0] != 'A') return;   // V = invalid

    _field(s, 7, f, sizeof(f));
    h->data.speed_kmh = strtof(f, NULL) * 1.852f;
}

static bool _parse_sentence(GPS_Handle *h, char *s) {
    if (!_verify_checksum(s)) return false;

    if (strncmp(s, "$GPGGA", 6) == 0 || strncmp(s, "$GNGGA", 6) == 0) {
        _parse_GGA(h, s);
        return true;
    }
    if (strncmp(s, "$GPRMC", 6) == 0 || strncmp(s, "$GNRMC", 6) == 0) {
        _parse_RMC(h, s);
        return true;
    }
    return false;
}

/* ════════════════════════════════
   PUBLIC API
   ════════════════════════════════ */

void GPS_Init(GPS_Handle *h, UART_HandleTypeDef *huart) {
    memset(h, 0, sizeof(GPS_Handle));
    h->huart = huart;
    HAL_UART_Receive_DMA(huart, h->dma_buf, GPS_DMA_BUF_SIZE);
}

bool GPS_Update(GPS_Handle *h) {
    bool got_new = false;

    uint16_t head = GPS_DMA_BUF_SIZE
                    - __HAL_DMA_GET_COUNTER(h->huart->hdmarx);

    while (h->parse_pos != head) {
        char c = (char)h->dma_buf[h->parse_pos];
        h->parse_pos = (h->parse_pos + 1) % GPS_DMA_BUF_SIZE;

        if (c == '$') {
            h->line_len = 0;
            h->line_buf[h->line_len++] = c;
        } else if (c == '\n' && h->line_len > 0) {
            h->line_buf[h->line_len] = '\0';
            if (_parse_sentence(h, h->line_buf)) got_new = true;
            h->line_len = 0;
        } else if (h->line_len > 0 && h->line_len < 127) {
            h->line_buf[h->line_len++] = c;
        }
    }
    return got_new;
}

bool GPS_IsValid(GPS_Handle *h) {
    if (!h->data.fix_valid) return false;
    return (HAL_GetTick() - h->data.last_update_tick) < 3000;
}
