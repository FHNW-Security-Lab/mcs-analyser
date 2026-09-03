#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t air_data;
    scanf("%lu", (unsigned long *)&air_data);

    /* [63:32] altitude ft, [31:16] vertical speed ft/min, [15:0] IAS kt*10. */
    const int32_t altitude_ft = (int32_t)(air_data >> 32);
    const int16_t vertical_speed_fpm = (int16_t)((air_data >> 16) & 0xffffULL);
    const uint16_t indicated_airspeed_kt_x10 = (uint16_t)(air_data & 0xffffULL);

    if (altitude_ft >= -2000 && altitude_ft <= 60000 &&
        vertical_speed_fpm >= -10000 && vertical_speed_fpm <= 10000 &&
        indicated_airspeed_kt_x10 >= 400 && indicated_airspeed_kt_x10 <= 6500) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_AIR_DATA,
               (unsigned long)air_data);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_SENSOR_ALERT,
               (unsigned long)0x0401ULL);
    }
    return 0;
}
