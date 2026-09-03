#ifndef AVIATION_MESSAGES_H
#define AVIATION_MESSAGES_H

#include <stdint.h>

/*
 * Demonstrator virtual links.  Each constant models one ARINC 664 Part 7
 * (AFDX-like) virtual-link payload carried by the analyser's existing
 * <message-id, uint64-payload> scanf/printf wire protocol.
 *
 * These are deliberately global 64-bit objects rather than enum members: the
 * MCA extracts their names and values from the ELF symbol table.
 */
const uint64_t MSG_AFDX_VL_GNSS_POSITION = 0xA101ULL;
const uint64_t MSG_AFDX_VL_GNSS_ALERT = 0xA102ULL;
const uint64_t MSG_AFDX_VL_INS_POSITION = 0xA111ULL;
const uint64_t MSG_AFDX_VL_RADIO_POSITION = 0xA121ULL;
const uint64_t MSG_AFDX_VL_AIR_DATA = 0xA131ULL;
const uint64_t MSG_AFDX_VL_ATTITUDE = 0xA141ULL;
const uint64_t MSG_AFDX_VL_WEATHER = 0xA151ULL;
const uint64_t MSG_AFDX_VL_SENSOR_ALERT = 0xA161ULL;
const uint64_t MSG_AFDX_ASD_DLS_ROUTE_LOAD = 0xA171ULL;
const uint64_t MSG_AFDX_VL_ROUTE_ACTIVE = 0xA172ULL;
const uint64_t MSG_AFDX_VL_ROUTE_REJECT = 0xA173ULL;
const uint64_t MSG_AFDX_VL_UNTRUSTED_NAV = 0xA181ULL;
const uint64_t MSG_AFDX_VL_UNTRUSTED_GUIDANCE = 0xA182ULL;
const uint64_t MSG_AFDX_VL_INGRESS_REJECT = 0xA183ULL;
const uint64_t MSG_AFDX_A429_RA1_HEIGHT = 0xA191ULL;
const uint64_t MSG_AFDX_A429_RA1_INVALID = 0xA192ULL;
const uint64_t MSG_AFDX_A429_RA2_HEIGHT = 0xA193ULL;
const uint64_t MSG_AFDX_A429_RA2_INVALID = 0xA194ULL;
const uint64_t MSG_AFDX_VL_RADIO_HEIGHT = 0xA195ULL;
const uint64_t MSG_AFDX_VL_RADIO_HEIGHT_UNAVAILABLE = 0xA196ULL;

const uint64_t MSG_AFDX_VL_NAV_SOLUTION = 0xA201ULL;
const uint64_t MSG_AFDX_VL_NAV_REJECT = 0xA202ULL;
const uint64_t MSG_AFDX_VL_NAV_DEGRADED_SOLUTION = 0xA203ULL;
const uint64_t MSG_AFDX_VL_FMS_TARGET = 0xA301ULL;
const uint64_t MSG_AFDX_VL_FMS_TRACK_POSITION = 0xA302ULL;
const uint64_t MSG_AFDX_VL_FLIGHT_GUIDANCE = 0xA311ULL;
const uint64_t MSG_AFDX_VL_ENVELOPE_COMMAND = 0xA401ULL;
const uint64_t MSG_AFDX_VL_ENVELOPE_ALERT = 0xA402ULL;
const uint64_t MSG_AFDX_VL_ACTUATOR_COMMAND = 0xA501ULL;
const uint64_t MSG_AFDX_VL_ACTUATOR_ALERT = 0xA502ULL;

const uint64_t MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE = 0xA601ULL;
const uint64_t MSG_AFDX_VL_AIRCRAFT_POSITION_STATE = 0xA602ULL;
const uint64_t MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE = 0xA603ULL;
const uint64_t MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE = 0xA604ULL;

#endif
