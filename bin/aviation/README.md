# Native aviation component model

This directory contains the x86-64 native binaries used by the ALBATROS web
demonstrator's real MCA/angr analysis.  It deliberately keeps each executable
small enough for symbolic execution while retaining separate avionics
responsibilities and explicit ARINC 664/AFDX-like virtual-link labels.

The analysis harness is the existing MCA protocol: sources read one unsigned
64-bit environment value with `scanf`; bus participants read an unsigned
64-bit message identifier and payload; outputs use `printf` with one concrete
message identifier and one 64-bit payload.  This is the harness boundary, not
a claim to encode the full ARINC 664 Ethernet frame.

Payloads are deterministic fixed point:

- position: signed latitude and longitude in microdegrees (`int32 | int32`);
- attitude/command: signed pitch and roll in centidegrees, unsigned heading in
  centidegrees, and 16 mode bits;
- air data: altitude in feet, vertical speed in feet/minute, IAS in 0.1 knots;
- weather: wind in 0.1 knots and bounded turbulence/icing categories;
- radio height: unsigned feet above ground on two explicitly labelled
  ARINC-429-like channels.

`make` builds matched `secure/` and `vulnerable/` binary sets.  The secure
navigation fusion applies route-aided two-of-three GNSS, INS and radio voting,
prefers INS, labels outlier-rejected solutions as degraded, and enforces a
simulation-aligned 45 m route residual; the secure envelope
always limits commands to 18 degrees pitch and 32 degrees roll.  The
vulnerable fusion trusts any syntactically valid GNSS coordinate and its
envelope contains an intentional direct-mode protection bypass. The expanded
model also contains an EFB/DLS route-load source and route-integrity guard, an
explicit untrusted control-domain source and AFDX publisher guard, two radio
altimeter channels, and a radio-height monitor. The secure build rejects a
route outside its validated corridor, rejects frames from the untrusted
publisher, and can select the second radio-height channel. The vulnerable
build passes the route and forged frames and depends on radio-altimeter channel
one. The aircraft effect binary exposes route-divergence and
envelope-violation message types so the MCA can prove profile differences from
compiled control flow.

The native analysis ranges over the component input domains discovered from
the binaries. A configured runtime scenario magnitude (for example a 4.5 km
GNSS pull-off) is a narrower experiment and is not automatically added as an
angr input assumption. The web UI therefore labels scenario bindings as native,
partial, configured, or plant-only and keeps the exact binary constraint beside
the configured scenario guard. The native geographic predicates use a
representative Berlin analysis fix; selectable WGS84 routes belong to the
runtime and reachability layers.

The visualization continues beyond these 20 analyzed binaries with a clearly
marked configured physical layer: autothrust/FADEC, engines, ailerons,
elevator, and rudder. These actors are terminal graph nodes: commands flow into
them, but no engine, surface-position, or state-measurement edges return to the
avionics. This keeps the influence path from GNSS/INS through navigation fusion
and flight control explicit. The physical edges are not additional native
binaries and are never included in the MCA evidence export.

Run both native builds and analyses from the repository root with:

```sh
scripts/build_aviation_analysis.sh
```

The strict JSON artifacts are written to `web/public/analysis/`.
