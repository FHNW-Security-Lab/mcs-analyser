#include <stdint.h>
#include <stdio.h>

#include "fixed_point.h"
#include "messages.h"

const char COMPONENT_BUILD_VERSION[] = "albatros-aviation-1.0.0";

static void emit_lateral_target(uint64_t payload) {
    const int32_t longitude_e6 = POSITION_LON_E6(payload);
    const int64_t lateral_error_e6 = (int64_t)longitude_e6 - 13404954LL;
    int16_t roll_target_cdeg = 0;
    uint16_t mode = 0;

    if (lateral_error_e6 > 1000000LL) {
        roll_target_cdeg = 7000;
        mode = MODE_NAV_DIRECT;
    } else if (lateral_error_e6 > 360000LL) {
        roll_target_cdeg = 4500;
    } else if (lateral_error_e6 > 20000LL) {
        roll_target_cdeg = 1500;
    } else if (lateral_error_e6 < -1000000LL) {
        roll_target_cdeg = -7000;
        mode = MODE_NAV_DIRECT;
    } else if (lateral_error_e6 < -360000LL) {
        roll_target_cdeg = -4500;
    } else if (lateral_error_e6 < -20000LL) {
        roll_target_cdeg = -1500;
    }

    const uint64_t target = pack_attitude(0, roll_target_cdeg, 18000, mode);
    printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FMS_TARGET,
           (unsigned long)target);
    printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FMS_TRACK_POSITION,
           (unsigned long)payload);
}

int main(void) {
    uint64_t message_id;
    uint64_t payload;
    scanf("%lu %lu", (unsigned long *)&message_id, (unsigned long *)&payload);

    if (message_id == MSG_AFDX_VL_NAV_SOLUTION ||
        message_id == MSG_AFDX_VL_NAV_DEGRADED_SOLUTION ||
        message_id == MSG_AFDX_VL_ROUTE_ACTIVE) {
        emit_lateral_target(payload);
    } else if (message_id == MSG_AFDX_VL_AIR_DATA) {
        const uint16_t airspeed_kt_x10 = (uint16_t)(payload & 0xffffULL);
        int16_t pitch_target_cdeg = 0;
        if (airspeed_kt_x10 < 1200) {
            pitch_target_cdeg = -800;
        } else if (airspeed_kt_x10 > 3200) {
            pitch_target_cdeg = 500;
        }
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FMS_TARGET,
               (unsigned long)pack_attitude(pitch_target_cdeg, 0, 18000, 0));
    } else if (message_id == MSG_AFDX_VL_WEATHER) {
        const uint8_t turbulence = (uint8_t)((payload >> 8) & 0xffULL);
        int16_t roll_target_cdeg = turbulence >= 2 ? 4000 : 800;
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FMS_TARGET,
               (unsigned long)pack_attitude(0, roll_target_cdeg, 18000,
                                            MODE_TURBULENCE));
    } else if (message_id == MSG_AFDX_VL_RADIO_HEIGHT) {
        const uint16_t radio_height_ft = RADIO_HEIGHT_FT(payload);
        const int16_t flare_pitch_cdeg = radio_height_ft < 60U ? 200 : 0;
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FMS_TARGET,
               (unsigned long)pack_attitude(flare_pitch_cdeg, 0, 18000,
                                            MODE_APPROACH));
    } else if (message_id == MSG_AFDX_VL_NAV_REJECT ||
               message_id == MSG_AFDX_VL_SENSOR_ALERT ||
               message_id == MSG_AFDX_VL_ROUTE_REJECT ||
               message_id == MSG_AFDX_VL_INGRESS_REJECT ||
               message_id == MSG_AFDX_VL_RADIO_HEIGHT_UNAVAILABLE) {
        printf("%lu %lu\n", (unsigned long)MSG_AFDX_VL_FMS_TARGET,
               (unsigned long)pack_attitude(0, 0, 18000, MODE_SENSOR_RECOVERY));
    }
    return 0;
}
