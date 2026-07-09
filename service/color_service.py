import http.server
import socketserver
import json
import winreg
import subprocess
import os
import time
import colorsys
import threading

PORT = 8765
POLICY_VALUE_NAME = "BrowserThemeColor"
MIN_REFRESH_INTERVAL = 0.25

DEFAULT_BROWSER = "brave"

BROWSER_CONFIGS = {
    "brave": {
        "policy_key": r"SOFTWARE\Policies\BraveSoftware\Brave",
        "exe_name": "brave.exe",
        "candidates": [
            r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe",
            r"%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe",
            r"%PROGRAMFILES(X86)%\BraveSoftware\Brave-Browser\Application\brave.exe",
        ],
    },
    "chrome": {
        "policy_key": r"SOFTWARE\Policies\Google\Chrome",
        "exe_name": "chrome.exe",
        "candidates": [
            r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe",
            r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe",
            r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
        ],
    },
    "edge": {
        "policy_key": r"SOFTWARE\Policies\Microsoft\Edge",
        "exe_name": "msedge.exe",
        "candidates": [
            r"%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe",
            r"%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe",
        ],
    },
}

_browser_path_cache = {}
_last_hex_by_browser = {}
_last_refresh_time = 0.0


def resolve_browser(name):
    if name in BROWSER_CONFIGS:
        return name
    return DEFAULT_BROWSER


def find_browser_exe(browser):
    config = BROWSER_CONFIGS[browser]
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%s" % config["exe_name"],
        ) as key:
            path, _ = winreg.QueryValueEx(key, None)
            if path and os.path.exists(path):
                return path
    except OSError:
        pass
    for c in config["candidates"]:
        expanded = os.path.expandvars(c)
        if os.path.exists(expanded):
            return expanded
    return None


def get_browser_path(browser):
    if browser not in _browser_path_cache:
        path = find_browser_exe(browser)
        _browser_path_cache[browser] = path
        if path:
            print(f"[color_service] found {browser} at: {path}")
        else:
            print(f"[color_service] WARNING: could not find {BROWSER_CONFIGS[browser]['exe_name']} automatically.")
    return _browser_path_cache[browser]


def set_theme_color_policy(hex_color, policy_key):
    key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, policy_key, 0, winreg.KEY_SET_VALUE)
    try:
        winreg.SetValueEx(key, POLICY_VALUE_NAME, 0, winreg.REG_SZ, hex_color)
    finally:
        winreg.CloseKey(key)


def clear_theme_color_policy(policy_key):
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, policy_key)
    except FileNotFoundError:
        pass
    except OSError:
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, policy_key, 0, winreg.KEY_SET_VALUE)
            try:
                winreg.DeleteValue(key, POLICY_VALUE_NAME)
            finally:
                winreg.CloseKey(key)
        except FileNotFoundError:
            pass


def refresh_policy(browser_path):
    if not browser_path:
        return
    subprocess.run(
        [browser_path, "--refresh-platform-policy", "--no-startup-window"],
        creationflags=subprocess.CREATE_NO_WINDOW,
        check=False,
    )


_pending_refresh_timer = None
_pending_refresh_lock = threading.Lock()


def schedule_refresh(browser_path):
    global _last_refresh_time, _pending_refresh_timer

    with _pending_refresh_lock:
        now = time.monotonic()
        remaining = MIN_REFRESH_INTERVAL - (now - _last_refresh_time)

        if _pending_refresh_timer is not None:
            _pending_refresh_timer.cancel()
            _pending_refresh_timer = None

        if remaining <= 0:
            refresh_policy(browser_path)
            _last_refresh_time = time.monotonic()
        else:
            def fire():
                global _last_refresh_time, _pending_refresh_timer
                refresh_policy(browser_path)
                _last_refresh_time = time.monotonic()
                with _pending_refresh_lock:
                    _pending_refresh_timer = None

            _pending_refresh_timer = threading.Timer(remaining, fire)
            _pending_refresh_timer.daemon = True
            _pending_refresh_timer.start()


NEUTRAL_SATURATION_THRESHOLD = 0.08
NEUTRAL_VALUE_THRESHOLD = 0.85


def snap_near_neutral(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if s < NEUTRAL_SATURATION_THRESHOLD and v > NEUTRAL_VALUE_THRESHOLD:
        grey = int(v * 255)
        return grey, grey, grey
    return r, g, b


def apply_color(r, g, b, browser):
    browser = resolve_browser(browser)
    policy_key = BROWSER_CONFIGS[browser]["policy_key"]

    r, g, b = snap_near_neutral(r, g, b)
    hex_color = "#%02x%02x%02x" % (r, g, b)
    print(f"[color_service] ({browser}) applying seed={hex_color}")

    if hex_color == _last_hex_by_browser.get(browser):
        return
    set_theme_color_policy(hex_color, policy_key)
    schedule_refresh(get_browser_path(browser))
    _last_hex_by_browser[browser] = hex_color


def apply_reset(browser):
    browser = resolve_browser(browser)
    policy_key = BROWSER_CONFIGS[browser]["policy_key"]

    print(f"[color_service] ({browser}) resetting to default theme")
    clear_theme_color_policy(policy_key)
    refresh_policy(get_browser_path(browser))
    _last_hex_by_browser[browser] = None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        return json.loads(body) if body else {}

    def do_POST(self):
        if self.path == "/color":
            try:
                data = self._read_json_body()
                r, g, b = int(data["r"]), int(data["g"]), int(data["b"])
                browser = data.get("browser")
            except Exception:
                self.send_response(400)
                self._cors_headers()
                self.end_headers()
                return
            apply_color(r, g, b, browser)
            self.send_response(204)
            self._cors_headers()
            self.end_headers()
        elif self.path == "/reset":
            try:
                data = self._read_json_body()
                browser = data.get("browser")
            except Exception:
                browser = None
            apply_reset(browser)
            self.send_response(204)
            self._cors_headers()
            self.end_headers()
        else:
            self.send_response(404)
            self._cors_headers()
            self.end_headers()


def main():
    print(f"Default browser (used only if a request omits one): {DEFAULT_BROWSER}")
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Listening on http://127.0.0.1:{PORT}/color and /reset -- leave this running.")
        print("Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
