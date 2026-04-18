# pam_ntag424 Makefile
#
# Requirements:
#   apt install libpcsclite-dev libssl-dev libpam0g-dev
#
# Build:
#   make
#
# Install:
#   make install         (copies pam_ntag424.so to /lib/security/)
#   make install-config  (copies example config to /etc/security/)

CC      ?= gcc
CFLAGS  ?= -Wall -Wextra -O2 -fPIC
LDFLAGS ?= -shared

# pkg-config is the canonical way to locate pcsclite headers
PCSC_CFLAGS  := $(shell pkg-config --cflags libpcsclite 2>/dev/null || echo -I/usr/include/PCSC)
PCSC_LIBS    := $(shell pkg-config --libs   libpcsclite 2>/dev/null || echo -lpcsclite)

CFLAGS  += $(PCSC_CFLAGS)
LIBS     = $(PCSC_LIBS) -lcrypto -lpam

TARGET   = pam_ntag424.so
SRC      = pam_ntag424.c

DESTDIR  ?=
PAM_LIB  ?= $(DESTDIR)/lib/security
CONF_DIR ?= $(DESTDIR)/etc/security

.PHONY: all clean install install-config test

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $< $(LIBS)

install: $(TARGET)
	install -D -m 0644 $(TARGET) $(PAM_LIB)/$(TARGET)

install-config:
	@if [ ! -f $(CONF_DIR)/pam_ntag424.conf ]; then \
	    install -D -m 0640 pam_ntag424.conf.example $(CONF_DIR)/pam_ntag424.conf; \
	    echo "Installed example config to $(CONF_DIR)/pam_ntag424.conf"; \
	    echo "IMPORTANT: edit $(CONF_DIR)/pam_ntag424.conf and set k1= and k2="; \
	else \
	    echo "Config already exists at $(CONF_DIR)/pam_ntag424.conf — not overwriting."; \
	fi

# test_crypto: standalone binary to verify the crypto primitives without PAM
test_crypto: test_crypto.c
	$(CC) $(PCSC_CFLAGS) -Wall -Wextra -O2 -o $@ $< -lcrypto

clean:
	rm -f $(TARGET) test_crypto
