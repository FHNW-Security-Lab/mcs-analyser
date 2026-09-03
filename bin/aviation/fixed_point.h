#ifndef AVIATION_FIXED_POINT_H
#define AVIATION_FIXED_POINT_H

#include <stdint.h>

/* WGS-84 latitude/longitude payload: signed microdegrees in two int32 words. */
#define POSITION_LAT_E6(payload) ((int32_t)((uint64_t)(payload) >> 32))
#define POSITION_LON_E6(payload) ((int32_t)((uint64_t)(payload) & 0xffffffffULL))

/*
 * Attitude/command payload:
 *   [63:48] signed pitch in centidegrees
 *   [47:32] signed roll in centidegrees
 *   [31:16] unsigned true heading in centidegrees
 *   [15:0]  mode/status flags
 */
#define ATTITUDE_PITCH_CDEG(payload) ((int16_t)((uint64_t)(payload) >> 48))
#define ATTITUDE_ROLL_CDEG(payload) ((int16_t)(((uint64_t)(payload) >> 32) & 0xffffULL))
#define ATTITUDE_YAW_CDEG(payload) ((uint16_t)(((uint64_t)(payload) >> 16) & 0xffffULL))
#define ATTITUDE_FLAGS(payload) ((uint16_t)((uint64_t)(payload) & 0xffffULL))

#define MODE_NAV_DIRECT 0x0001U
#define MODE_ENVELOPE_LIMITED 0x0002U
#define MODE_TURBULENCE 0x0004U
#define MODE_SENSOR_RECOVERY 0x0008U
#define MODE_APPROACH 0x0010U
#define MODE_RADIO_HEIGHT_INVALID 0x0020U

/* Radio-height payload: [15:0] height above ground in feet. */
#define RADIO_HEIGHT_FT(payload) ((uint16_t)((uint64_t)(payload) & 0xffffULL))

static inline uint64_t pack_attitude(int16_t pitch_cdeg, int16_t roll_cdeg,
                                     uint16_t yaw_cdeg, uint16_t flags) {
    return ((uint64_t)(uint16_t)pitch_cdeg << 48) |
           ((uint64_t)(uint16_t)roll_cdeg << 32) |
           ((uint64_t)yaw_cdeg << 16) |
           (uint64_t)flags;
}

static inline int32_t clamp_i32(int32_t value, int32_t minimum, int32_t maximum) {
    if (value < minimum) {
        return minimum;
    }
    if (value > maximum) {
        return maximum;
    }
    return value;
}

#endif
