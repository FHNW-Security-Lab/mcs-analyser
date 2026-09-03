#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.1.0";

int main(void) {
    uint64_t attacker_payload;
    scanf("%lu", (unsigned long *)&attacker_payload);

    /* Bit zero chooses a forged post-fusion position or guidance command. */
    if ((attacker_payload & 1ULL) != 0ULL) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_UNTRUSTED_NAV,
               (unsigned long)attacker_payload);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_UNTRUSTED_GUIDANCE,
               (unsigned long)attacker_payload);
    }
    return 0;
}
