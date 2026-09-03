CC ?= gcc
CFLAGS := -std=c11 -g3 -O0 -fno-inline -fno-omit-frame-pointer \
	-fno-stack-protector -fno-pie -no-pie -Wall -Wextra

SOURCES := $(sort $(wildcard c*.c))
NAMES := $(SOURCES:.c=)
SECURE_DIR := secure
VULNERABLE_DIR := vulnerable
SECURE_TARGETS := $(addprefix $(SECURE_DIR)/,$(NAMES))
VULNERABLE_TARGETS := $(addprefix $(VULNERABLE_DIR)/,$(NAMES))

all: secure vulnerable

secure: $(SECURE_TARGETS)

vulnerable: $(VULNERABLE_TARGETS)

$(SECURE_DIR)/%: %.c messages.h fixed_point.h
	mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -DAVIATION_SECURE=1 $< -o $@

$(VULNERABLE_DIR)/%: %.c messages.h fixed_point.h
	mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -DAVIATION_VULNERABLE=1 $< -o $@

clean:
	rm -rf $(SECURE_DIR) $(VULNERABLE_DIR)

.PHONY: all secure vulnerable clean
