#!/usr/bin/env python3
"""Dev server with no-cache headers so edits land without a hard refresh.

Usage:
    python3 serve.py            # serves on http://localhost:8765
    python3 serve.py 9000       # serves on http://localhost:9000
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    with ThreadingHTTPServer(('', port), NoCacheHandler) as httpd:
        print(f'Serving http://localhost:{port}/ with no-cache headers (Ctrl-C to stop)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()
