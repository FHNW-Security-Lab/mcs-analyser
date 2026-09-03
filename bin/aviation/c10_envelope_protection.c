#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id == MSG_AFDX_VL_FLIGHT_GUIDANCE) {
        const int16_t requested_pitch = ATTITUDE_PITCH_CDEG(payload);
        const int16_t requested_roll = ATTITUDE_ROLL_CDEG(payload);
        const uint16_t requested_yaw = ATTITUDE_YAW_CDEG(payload);
        uint16_t flags = ATTITUDE_FLAGS(payload);
        int32_t protected_pitch = requested_pitch;
        int32_t protected_roll = requested_roll;

#ifndef AVIATION_SECURE
        /* Vulnerable maintenance/direct-law defect: NAV_DIRECT skips protections. */
        if ((flags & MODE_NAV_DIRECT) == 0U) {
#endif
            protected_pitch = clamp_i32(protected_pitch, -1800, 1800);
            protected_roll = clamp_i32(protected_roll, -3200, 3200);
#ifndef AVIATION_SECURE
        }
#endif

        if (protected_pitch != requested_pitch || protected_roll != requested_roll) {
            flags |= MODE_ENVELOPE_LIMITED;
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ENVELOPE_ALERT,
                   (unsigned long)0x1001ULL);
        }

        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ENVELOPE_COMMAND,
               (unsigned long)pack_attitude((int16_t)protected_pitch,
                                            (int16_t)protected_roll,
                                            requested_yaw, flags));
    }
    return 0;
}
