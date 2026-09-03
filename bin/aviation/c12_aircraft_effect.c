#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

static int inside_route_monitor(uint64_t position) {
    const int32_t latitude_e6 = POSITION_LAT_E6(position);
    const int32_t longitude_e6 = POSITION_LON_E6(position);
    return latitude_e6 >= 52519603 && latitude_e6 <= 52520413 &&
           longitude_e6 >= 13404294 && longitude_e6 <= 13405614;
}

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id == MSG_AFDX_VL_ACTUATOR_COMMAND) {
        const int16_t pitch_cdeg = ATTITUDE_PITCH_CDEG(payload);
        const int16_t roll_cdeg = ATTITUDE_ROLL_CDEG(payload);
        if (pitch_cdeg < -1800 || pitch_cdeg > 1800 ||
            roll_cdeg < -3200 || roll_cdeg > 3200) {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE,
                   (unsigned long)payload);
        } else {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE,
                   (unsigned long)payload);
        }
    } else if (message_id == MSG_AFDX_VL_FMS_TRACK_POSITION) {
        if (inside_route_monitor(payload)) {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_AIRCRAFT_POSITION_STATE,
                   (unsigned long)payload);
        } else {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE,
                   (unsigned long)payload);
        }
    }
    return 0;
}
