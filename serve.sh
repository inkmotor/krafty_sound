#!/bin/sh
# Serve Krafty Sound to this computer and to anything on the same wifi.
# Uses Ruby's webrick if it's there (macOS's own Ruby has it), else Python 3.
# Either way every response says "don't cache", so a reload picks up the latest code.
cd "$(dirname "$0")"
PORT=${1:-8776}
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "  Krafty Sound is running."
echo "  On this computer:  http://localhost:$PORT"
[ -n "$IP" ] && echo "  On the same wifi:  http://$IP:$PORT   (the microphone needs localhost or https)"
echo ""
echo "  Ctrl+C to stop."
echo ""
if command -v ruby >/dev/null 2>&1 && ruby -e "require 'webrick'" >/dev/null 2>&1; then
  exec ruby serve.rb "$PORT"
elif command -v python3 >/dev/null 2>&1; then
  exec python3 - "$PORT" <<'EOF'
import sys, http.server, socketserver
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', int(sys.argv[1])), H) as s:
    try: s.serve_forever()
    except KeyboardInterrupt: pass
EOF
else
  echo "  Needs Ruby (with webrick) or Python 3." >&2
  exit 1
fi
