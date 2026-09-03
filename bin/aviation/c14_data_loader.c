#include <stdint.h>
#include <stdio.h>

#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.1.0";

int main(void) {
    uint64_t uploaded_route;
    scanf("%lu", (unsigned long *)&uploaded_route);

    /* Synthetic ASD/ACD boundary source: an EFB-provided active-leg fix. */
    printf("%lu %lu\n", (unsigned long)MSG_AFDX_ASD_DLS_ROUTE_LOAD,
           (unsigned long)uploaded_route);
    return 0;
}
