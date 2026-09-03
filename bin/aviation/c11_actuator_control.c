#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id == MSG_AFDX_VL_ENVELOPE_COMMAND) {
        const int16_t pitch_cdeg = ATTITUDE_PITCH_CDEG(payload);
        const int16_t roll_cdeg = ATTITUDE_ROLL_CDEG(payload);

        /* Independent mechanical travel monitor; design limit remains 32 deg. */
        if (pitch_cdeg >= -2500 && pitch_cdeg <= 2500 &&
            roll_cdeg >= -7000 && roll_cdeg <= 7000) {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ACTUATOR_COMMAND,
                   (unsigned long)payload);
        } else {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ACTUATOR_ALERT,
                   (unsigned long)0x1101ULL);
        }
    } else if (message_id == MSG_AFDX_VL_ENVELOPE_ALERT) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ACTUATOR_ALERT,
               (unsigned long)(payload | 0x1100ULL));
    }
    return 0;
}
