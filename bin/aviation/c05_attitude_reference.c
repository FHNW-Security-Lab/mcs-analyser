#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t attitude;
    scanf("%lu", (unsigned long *)&attitude);

    const int16_t pitch_cdeg = ATTITUDE_PITCH_CDEG(attitude);
    const int16_t roll_cdeg = ATTITUDE_ROLL_CDEG(attitude);
    const uint16_t yaw_cdeg = ATTITUDE_YAW_CDEG(attitude);

    if (pitch_cdeg >= -9000 && pitch_cdeg <= 9000 &&
        roll_cdeg >= -18000 && roll_cdeg <= 18000 && yaw_cdeg < 36000) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ATTITUDE,
               (unsigned long)attitude);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_SENSOR_ALERT,
               (unsigned long)0x0501ULL);
    }
    return 0;
}
