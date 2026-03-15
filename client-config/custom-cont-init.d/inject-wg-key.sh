#!/bin/bash
# Replace placeholder with actual private key from environment variable
sed -i "s|WG_PRIVATE_KEY_PLACEHOLDER|${WG_PRIVATE_KEY}|g" /config/wg_confs/wg0.conf
