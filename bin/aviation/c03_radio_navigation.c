#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t radio_position;
    scanf("%lu", (unsigned long *)&radio_position);

    const int32_t latitude_e6 = POSITION_LAT_E6(radio_position);
    const int32_t longitude_e6 = POSITION_LON_E6(radio_position);

    /* DME/DME or VOR/DME solution availability inside the regional navaid net. */
    if (latitude_e6 >= 48000000 && latitude_e6 <= 54500000 &&
        longitude_e6 >= 6000000 && longitude_e6 <= 15500000) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_RADIO_POSITION,
               (unsigned long)radio_position);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_SENSOR_ALERT,
               (unsigned long)0x0301ULL);
    }
    return 0;
}
