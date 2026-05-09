#ifndef APP_STATE_H
#define APP_STATE_H

#include <stdint.h>

typedef enum {
    SYS_BOOTING = 0,
    SYS_HANDSHAKING,
    SYS_RUNNING,
    SYS_PI_LOST,
    SYS_SHUTDOWN,
} SystemState_t;

/* Cortex-M3 word-aligned access is atomic — no mutex needed for these. */
extern volatile SystemState_t g_sys_state;
extern volatile uint32_t      g_pi_last_hb_tick;

#endif /* APP_STATE_H */
