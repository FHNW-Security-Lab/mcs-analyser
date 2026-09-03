#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.1.0";

int main(void) {
    uint64_t raw_height;
    scanf("%lu", (unsigned long *)&raw_height);
    if ((raw_height & 0xffffULL) <= 2500ULL) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_A429_RA1_HEIGHT,
               (unsigned long)(raw_height & 0xffffULL));
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_A429_RA1_INVALID,
               (unsigned long)0x1801ULL);
    }
    return 0;
}
