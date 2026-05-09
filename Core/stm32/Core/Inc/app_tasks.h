#ifndef APP_TASKS_H
#define APP_TASKS_H

/* Stack depths in words (1 word = 4 bytes on Cortex-M3) */
#define STACK_COMM   256U
#define STACK_GPS    192U
#define STACK_RFID   128U
#define STACK_AUDIO  128U
/* Task priorities (0 = idle, 5 = timer daemon / highest application) */
#define PRIO_COMM    4U
#define PRIO_GPS     3U
#define PRIO_RFID    2U
#define PRIO_AUDIO   1U

void Task_Comm (void *arg);
void Task_Gps  (void *arg);
void Task_Rfid (void *arg);
void Task_Audio(void *arg);

#endif /* APP_TASKS_H */
