#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    /* Consumer-only sink, modelled as volatile display/safety annunciator state. */
    volatile uint64_t display_state = 0;
    if (message_id == MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE) {
        display_state = payload;
    } else if (message_id == MSG_AFDX_VL_AIRCRAFT_POSITION_STATE) {
        display_state = payload;
    } else if (message_id == MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE) {
        display_state = payload | 0x8000000000000000ULL;
    } else if (message_id == MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE) {
        display_state = payload | 0x4000000000000000ULL;
    }
    return display_state == UINT64_MAX ? 1 : 0;
}
