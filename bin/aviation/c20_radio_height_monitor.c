#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.1.0";

#ifdef AVIATION_SECURE
int main(void) {
    uint64_t first_id;
    uint64_t first_payload;
    uint64_t second_id;
    uint64_t second_payload;
    scanf("%lu %lu", (unsigned long *)&first_id, (unsigned long *)&first_payload);
    scanf("%lu %lu", (unsigned long *)&second_id, (unsigned long *)&second_payload);

    const int first_valid = first_id == MSG_AFDX_A429_RA1_HEIGHT ||
                            first_id == MSG_AFDX_A429_RA2_HEIGHT;
    const int second_valid = second_id == MSG_AFDX_A429_RA1_HEIGHT ||
                             second_id == MSG_AFDX_A429_RA2_HEIGHT;
    const int first_ra1 = first_id == MSG_AFDX_A429_RA1_HEIGHT ||
                          first_id == MSG_AFDX_A429_RA1_INVALID;
    const int first_ra2 = first_id == MSG_AFDX_A429_RA2_HEIGHT ||
                          first_id == MSG_AFDX_A429_RA2_INVALID;
    const int second_ra1 = second_id == MSG_AFDX_A429_RA1_HEIGHT ||
                           second_id == MSG_AFDX_A429_RA1_INVALID;
    const int second_ra2 = second_id == MSG_AFDX_A429_RA2_HEIGHT ||
                           second_id == MSG_AFDX_A429_RA2_INVALID;
    if (!((first_ra1 && second_ra2) || (first_ra2 && second_ra1))) {
        return 0;
    }
    if (first_valid) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_RADIO_HEIGHT,
               (unsigned long)first_payload);
    } else if (second_valid) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_RADIO_HEIGHT,
               (unsigned long)second_payload);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_RADIO_HEIGHT_UNAVAILABLE,
               (unsigned long)0x2001ULL);
    }
    return 0;
}
#else
int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);
    if (message_id == MSG_AFDX_A429_RA1_HEIGHT) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_RADIO_HEIGHT,
               (unsigned long)payload);
    } else if (message_id == MSG_AFDX_A429_RA1_INVALID) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_RADIO_HEIGHT_UNAVAILABLE,
               (unsigned long)0x2002ULL);
    }
    return 0;
}
#endif
