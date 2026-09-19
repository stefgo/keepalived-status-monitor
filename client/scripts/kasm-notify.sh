#!/bin/sh
# keepalived notify script for the kasm agent: tells the agent that an instance or sync group
# changed state, so it reads keepalived now instead of at its next poll.
#
# Install on the keepalived host (not in the agent's container), owned by root and not
# writable by anybody else -- keepalived refuses such a script with enable_script_security:
#
#   install -m 0755 kasm-notify.sh /etc/keepalived/kasm-notify.sh
#   printf '%s' '<the agent's keepalived.notifyToken>' > /etc/keepalived/kasm-notify.token
#   chmod 600 /etc/keepalived/kasm-notify.token
#
# and in keepalived.conf:
#
#   global_defs {
#       enable_script_security
#       script_user root
#   }
#   vrrp_instance VI_1 {            # or vrrp_sync_group, or both
#       notify /etc/keepalived/kasm-notify.sh
#   }
#
# keepalived passes: $1 INSTANCE or GROUP, $2 the name, $3 the new state, $4 the priority.
# The agent only logs them; what it reports comes from its own reading.
#
# KASM_NOTIFY_URL and KASM_NOTIFY_TOKEN_FILE override the defaults below.

URL="${KASM_NOTIFY_URL:-http://127.0.0.1:3011/api/keepalived/notify}"
TOKEN_FILE="${KASM_NOTIFY_TOKEN_FILE:-/etc/keepalived/kasm-notify.token}"

TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null) || exit 0

# Plain text rather than JSON: a name with a quote in it cannot break the request.
# Never fails: an agent that is down must not show up as an error in keepalived's log.
curl -fsS -m 2 -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: text/plain" \
    --data "$1 $2 $3 $4" \
    "$URL" >/dev/null 2>&1 || true
exit 0
