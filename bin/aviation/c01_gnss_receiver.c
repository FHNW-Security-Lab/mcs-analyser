#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t raw_position;
    scanf("%lu", (unsigned long *)&raw_position);

    const int32_t latitude_e6 = POSITION_LAT_E6(raw_position);
    const int32_t longitude_e6 = POSITION_LON_E6(raw_position);

    /* Receiver-level ICD validation: valid WGS-84 coordinate encoding. */
    if (latitude_e6 >= -90000000 && latitude_e6 <= 90000000 &&
        longitude_e6 >= -180000000 && longitude_e6 <= 180000000) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_GNSS_POSITION,
               (unsigned long)raw_position);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_GNSS_ALERT,
               (unsigned long)0x0101ULL);
    }
    return 0;
}
