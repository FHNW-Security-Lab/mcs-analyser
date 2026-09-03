#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

#ifdef AVIATION_SECURE
/* Berlin analysis fix and the simulation-aligned approximately 45 m residual. */
static int inside_route_residual(uint64_t position) {
    const int32_t latitude_e6 = POSITION_LAT_E6(position);
    const int32_t longitude_e6 = POSITION_LON_E6(position);
    return (latitude_e6 >= 52519603) & (latitude_e6 <= 52520413) &
           (longitude_e6 >= 13404294) & (longitude_e6 <= 13405614);
}

int main(void) {
    uint64_t gnss_id;
    uint64_t gnss_position;
    uint64_t ins_id;
    uint64_t ins_position;
    uint64_t radio_id;
    uint64_t radio_position;

    /* Fixed AFDX sampling slots keep the native voting logic angr-tractable. */
    scanf("%lu %lu", (unsigned long *)&gnss_id, (unsigned long *)&gnss_position);
    scanf("%lu %lu", (unsigned long *)&ins_id, (unsigned long *)&ins_position);
    scanf("%lu %lu", (unsigned long *)&radio_id, (unsigned long *)&radio_position);

    if (gnss_id == MSG_AFDX_VL_GNSS_POSITION &&
        ins_id == MSG_AFDX_VL_INS_POSITION &&
        radio_id == MSG_AFDX_VL_RADIO_POSITION) {
        uint64_t selected_position = 0;
        int selection_valid = 0;
        int selection_degraded = 0;
        const int gnss_valid = inside_route_residual(gnss_position);
        const int ins_valid = inside_route_residual(ins_position);
        const int radio_valid = inside_route_residual(radio_position);

        /* Prefer an in-corridor INS corroborated by either independent source. */
        if (ins_valid & (radio_valid | gnss_valid)) {
            selected_position = ins_position;
            selection_valid = 1;
            selection_degraded = !(gnss_valid & radio_valid);
        /* Degraded INS: radio outranks GNSS when both remain route-consistent. */
        } else if (radio_valid & gnss_valid) {
            selected_position = radio_position;
            selection_valid = 1;
            selection_degraded = 1;
        }

        if (selection_valid && selection_degraded) {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_NAV_DEGRADED_SOLUTION,
                   (unsigned long)selected_position);
        } else if (selection_valid) {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_NAV_SOLUTION,
                   (unsigned long)selected_position);
        } else {
            printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_NAV_REJECT,
                   (unsigned long)0x0701ULL);
        }
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_NAV_REJECT,
               (unsigned long)0x0702ULL);
    }
    return 0;
}
#else
int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id == MSG_AFDX_VL_GNSS_POSITION) {
        /* Demonstration defect: syntactically valid GNSS is granted full authority. */
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_NAV_SOLUTION,
               (unsigned long)payload);
    } else if (message_id == MSG_AFDX_VL_GNSS_ALERT) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_NAV_REJECT,
               (unsigned long)(payload | 0x7000ULL));
    }
    return 0;
}
#endif
