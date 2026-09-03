#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t weather;
    scanf("%lu", (unsigned long *)&weather);

    /* [31:16] wind kt*10, [15:8] turbulence 0..3, [7:0] icing 0..3. */
    const uint16_t wind_kt_x10 = (uint16_t)((weather >> 16) & 0xffffULL);
    const uint8_t turbulence = (uint8_t)((weather >> 8) & 0xffULL);
    const uint8_t icing = (uint8_t)(weather & 0xffULL);

    if (wind_kt_x10 <= 2500 && turbulence <= 3 && icing <= 3) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_WEATHER,
               (unsigned long)weather);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_SENSOR_ALERT,
               (unsigned long)0x0601ULL);
    }
    return 0;
}
