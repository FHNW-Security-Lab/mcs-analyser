#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t inertial_position;
    scanf("%lu", (unsigned long *)&inertial_position);

    const int32_t latitude_e6 = POSITION_LAT_E6(inertial_position);
    const int32_t longitude_e6 = POSITION_LON_E6(inertial_position);

    /* IRS alignment/transport-wander monitor, bounded to the operating region. */
    if (latitude_e6 >= 47000000 && latitude_e6 <= 55000000 &&
        longitude_e6 >= 5000000 && longitude_e6 <= 16000000) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_INS_POSITION,
               (unsigned long)inertial_position);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_SENSOR_ALERT,
               (unsigned long)0x0201ULL);
    }
    return 0;
}
