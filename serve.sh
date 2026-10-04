#!/bin/sh
# Serve Krafty Sound to this Mac and to anything on the same wifi (your iPad).
cd "$(dirname "$0")"
PORT=${1:-8776}
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "  Krafty Sound is running."
echo "  On this Mac:  http://localhost:$PORT"
[ -n "$IP" ] && echo "  On your iPad: http://$IP:$PORT   (same wifi)"
echo ""
echo "  Ctrl+C to stop."
echo ""
exec /usr/bin/ruby serve.rb "$PORT"
