#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.1.0";

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id != MSG_AFDX_VL_UNTRUSTED_NAV &&
        message_id != MSG_AFDX_VL_UNTRUSTED_GUIDANCE) {
        return 0;
    }

#ifdef AVIATION_SECURE
    /* The external source is absent from both allowed publisher sets. */
    printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_INGRESS_REJECT,
           (unsigned long)0x1701ULL);
#else
    if (message_id == MSG_AFDX_VL_UNTRUSTED_NAV) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_NAV_SOLUTION,
               (unsigned long)payload);
    } else {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FLIGHT_GUIDANCE,
               (unsigned long)payload);
    }
#endif
    return 0;
}
