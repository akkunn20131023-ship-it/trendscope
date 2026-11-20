# -*- coding: utf-8 -*-
"""Windows タスクトレイ常駐（追加ライブラリ不要・ctypes のみ）"""
import ctypes
import os
import sys
import threading
import webbrowser
from ctypes import wintypes as W

WM_USER = 0x0400
WM_TRAY = WM_USER + 20
WM_COMMAND, WM_DESTROY, WM_CLOSE = 0x0111, 0x0002, 0x0010
WM_LBUTTONDBLCLK, WM_RBUTTONUP, WM_LBUTTONUP = 0x0203, 0x0205, 0x0202
NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 1, 2, 4, 0x10
TPM_RETURNCMD, TPM_RIGHTBUTTON = 0x0100, 0x0002
MF_STRING, MF_SEPARATOR = 0, 0x800
IMAGE_ICON, LR_LOADFROMFILE, LR_DEFAULTSIZE = 1, 0x10, 0x40

LRESULT = ctypes.c_ssize_t
WNDPROC = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)(LRESULT, W.HWND, W.UINT, W.WPARAM, W.LPARAM)


class WNDCLASSW(ctypes.Structure):
    _fields_ = [("style", W.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", W.HINSTANCE), ("hIcon", W.HICON), ("hCursor", W.HANDLE), ("hbrBackground", W.HBRUSH),
                ("lpszMenuName", W.LPCWSTR), ("lpszClassName", W.LPCWSTR)]


class GUID(ctypes.Structure):
    _fields_ = [("d1", W.DWORD), ("d2", W.WORD), ("d3", W.WORD), ("d4", ctypes.c_ubyte * 8)]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [("cbSize", W.DWORD), ("hWnd", W.HWND), ("uID", W.UINT), ("uFlags", W.UINT), ("uCallbackMessage", W.UINT),
                ("hIcon", W.HICON), ("szTip", W.WCHAR * 128), ("dwState", W.DWORD), ("dwStateMask", W.DWORD),
                ("szInfo", W.WCHAR * 256), ("uVersion", W.UINT), ("szInfoTitle", W.WCHAR * 64), ("dwInfoFlags", W.DWORD),
                ("guidItem", GUID), ("hBalloonIcon", W.HICON)]


class MSG(ctypes.Structure):
    _fields_ = [("hwnd", W.HWND), ("message", W.UINT), ("wParam", W.WPARAM), ("lParam", W.LPARAM), ("time", W.DWORD),
                ("pt", W.POINT)]


class Tray:
    def __init__(self, port_ref, on_restart, on_quit, icon_path=None):
        self.port_ref, self.on_restart, self.on_quit = port_ref, on_restart, on_quit
        self.icon_path = icon_path
        self.hwnd = None
        self.nid = None
        self.ready = threading.Event()

    def url(self, q=""):
        return f"http://localhost:{self.port_ref[0]}/{q}"

    def start(self):
        threading.Thread(target=self._run, daemon=True).start()
        self.ready.wait(5)

    def notify(self, title, msg):
        if not self.nid:
            return
        self.nid.uFlags = NIF_INFO
        self.nid.szInfoTitle = title[:63]
        self.nid.szInfo = msg[:255]
        self.nid.dwInfoFlags = 1  # NIIF_INFO
        ctypes.windll.shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(self.nid))

    def _menu(self):
        u32 = ctypes.windll.user32
        m = u32.CreatePopupMenu()
        items = [(1, "🌍 TrendScope を開く"), (2, "📋 ダイジェスト"), (3, "🗺 世界マップ"), (4, "🗾 温度差"), (0, None),
                 (5, "🔄 再起動"), (6, "❌ 終了")]
        for cid, text in items:
            if cid == 0:
                u32.AppendMenuW(m, MF_SEPARATOR, 0, None)
            else:
                u32.AppendMenuW(m, MF_STRING, cid, text)
        pt = W.POINT()
        u32.GetCursorPos(ctypes.byref(pt))
        u32.SetForegroundWindow(self.hwnd)
        cmd = u32.TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, self.hwnd, None)
        u32.DestroyMenu(m)
        if cmd == 1:
            webbrowser.open(self.url())
        elif cmd == 2:
            webbrowser.open(self.url("?view=digest"))
        elif cmd == 3:
            webbrowser.open(self.url("?view=map"))
        elif cmd == 4:
            webbrowser.open(self.url("?view=compare"))
        elif cmd == 5:
            self.remove(); self.on_restart()
        elif cmd == 6:
            self.remove(); self.on_quit()

    def remove(self):
        if self.nid:
            ctypes.windll.shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self.nid))
            self.nid = None

    def _run(self):
        u32, k32 = ctypes.windll.user32, ctypes.windll.kernel32
        u32.DefWindowProcW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        u32.DefWindowProcW.restype = LRESULT
        u32.CreateWindowExW.restype = W.HWND
        u32.CreateWindowExW.argtypes = [W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                        ctypes.c_int, W.HWND, W.HMENU, W.HINSTANCE, W.LPVOID]
        u32.LoadImageW.restype = W.HANDLE
        u32.LoadIconW.restype = W.HICON
        u32.LoadIconW.argtypes = [W.HINSTANCE, W.LPVOID]
        u32.TrackPopupMenu.argtypes = [W.HMENU, W.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HWND, W.LPVOID]
        u32.CreatePopupMenu.restype = W.HMENU
        u32.AppendMenuW.argtypes = [W.HMENU, W.UINT, ctypes.c_size_t, W.LPCWSTR]
        k32.GetModuleHandleW.restype = W.HMODULE

        def proc(hwnd, msg, wp, lp):
            if msg == WM_TRAY:
                if lp in (WM_LBUTTONDBLCLK, WM_LBUTTONUP):
                    webbrowser.open(self.url())
                elif lp == WM_RBUTTONUP:
                    self._menu()
                return 0
            if msg == WM_DESTROY:
                self.remove()
                u32.PostQuitMessage(0)
                return 0
            return u32.DefWindowProcW(hwnd, msg, wp, lp)

        self._proc = WNDPROC(proc)  # GCされないよう保持
        hinst = k32.GetModuleHandleW(None)
        wc = WNDCLASSW()
        wc.lpfnWndProc = self._proc
        wc.hInstance = hinst
        wc.lpszClassName = "TrendScopeTray"
        u32.RegisterClassW(ctypes.byref(wc))
        self.hwnd = u32.CreateWindowExW(0, "TrendScopeTray", "TrendScope", 0, 0, 0, 0, 0, None, None, hinst, None)
        hicon = None
        if self.icon_path and os.path.exists(self.icon_path):
            hicon = u32.LoadImageW(None, self.icon_path, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
        if not hicon:
            hicon = u32.LoadIconW(None, ctypes.c_void_p(32516))  # IDI_INFORMATION
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self.hwnd
        nid.uID = 1
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        nid.uCallbackMessage = WM_TRAY
        nid.hIcon = hicon
        nid.szTip = "TrendScope（クリックで開く／右クリックでメニュー）"
        ctypes.windll.shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))
        self.nid = nid
        self.ready.set()
        msg = MSG()
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            u32.TranslateMessage(ctypes.byref(msg))
            u32.DispatchMessageW(ctypes.byref(msg))


def make_icon(path):
    """32x32 の地球っぽいアイコン(.ico)を生成"""
    if os.path.exists(path):
        return path
    import struct
    w = h = 32
    px = bytearray()
    for y in range(h - 1, -1, -1):  # BMPは下から
        for x in range(w):
            dx, dy = x - 15.5, y - 15.5
            d = (dx * dx + dy * dy) ** 0.5
            if d > 15.5:
                px += bytes([0, 0, 0, 0])
            elif d > 13.5:
                px += bytes([0xc3, 0xe0, 0x7e, 255])  # 縁(BGRA)
            else:
                land = ((x * 7 + y * 3) % 11 < 4 and abs(dy) < 11) or (abs(dx + 4) < 4 and dy < -3)
                px += bytes([0x5b, 0xc4, 0x46, 255]) if land else bytes([0xff, 0x9d, 0x5b, 255])
    mask = bytes(((w + 31) // 32) * 4 * h)
    bmp = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(px) + len(mask), 0, 0, 0, 0) + bytes(px) + mask
    ico = struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(bmp), 22) + bmp
    with open(path, "wb") as f:
        f.write(ico)
    return path
