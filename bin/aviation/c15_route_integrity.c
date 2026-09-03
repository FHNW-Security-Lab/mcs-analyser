#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.1.0";

#ifdef AVIATION_SECURE
static int inside_loaded_route_corridor(uint64_t position) {
    const int32_t latitude_e6 = POSITION_LAT_E6(position);
    const int32_t longitude_e6 = POSITION_LON_E6(position);
    return latitude_e6 >= 52519603 && latitude_e6 <= 52520413 &&
           longitude_e6 >= 13404294 && longitude_e6 <= 13405614;
}
#endif

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id != MSG_AFDX_ASD_DLS_ROUTE_LOAD) {
        return 0;
    }

#ifdef AVIATION_SECURE
    /* Represents signature/revision validation plus a route-corridor check. */
    if (inside_loaded_route_corridor(payload)) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ROUTE_ACTIVE,
               (unsigned long)payload);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ROUTE_REJECT,
               (unsigned long)0x1501ULL);
    }
#else
    /* Baseline defect: an ASD load receives ACD route authority unchecked. */
    printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_ROUTE_ACTIVE,
           (unsigned long)payload);
#endif
    return 0;
}
