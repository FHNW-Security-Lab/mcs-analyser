#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id == MSG_AFDX_VL_FMS_TARGET) {
        /* Command is already fixed-point; the FG preserves authority/mode bits. */
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FLIGHT_GUIDANCE,
               (unsigned long)payload);
    } else if (message_id == MSG_AFDX_VL_ATTITUDE) {
        const int16_t measured_pitch = ATTITUDE_PITCH_CDEG(payload);
        const int16_t measured_roll = ATTITUDE_ROLL_CDEG(payload);
        const int32_t pitch_correction = clamp_i32(-(int32_t)measured_pitch, -1200, 1200);
        const int32_t roll_correction = clamp_i32(-(int32_t)measured_roll, -2500, 2500);
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FLIGHT_GUIDANCE,
               (unsigned long)pack_attitude((int16_t)pitch_correction,
                                            (int16_t)roll_correction,
                                            ATTITUDE_YAW_CDEG(payload), 0));
    }
    return 0;
}
