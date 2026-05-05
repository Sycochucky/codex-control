from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import socket
import subprocess
from subprocess import CREATE_NO_WINDOW
import time
from tkinter import END, StringVar, Tk, Text, messagebox, ttk
from typing import Any, Literal
from urllib.parse import SplitResult, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[2]
DESKTOP_SERVER_DIR = ROOT / "desktop-server"
PHONE_APP_DIR = ROOT / "phone-app"
RUNTIME_DIR = DESKTOP_SERVER_DIR / "runtime" / "gui-control"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

PROFILE_PATH = RUNTIME_DIR / "profiles.json"

TARGETS = ("backend", "expo", "apk-local", "eas-cloud")
DEFAULT_BACKEND_PORT = "8010"
DEFAULT_EXPO_PORT = "8081"
DEFAULT_EAS_PROFILE = "preview"
LEGACY_LOCAL_URL = "http://192.168.50.137:8000"
MANAGED_BY = "control_panel_gui"
PS1_MANAGED_BY = "control_panel_ps1"
QuickCommand = Literal["install", "typecheck", "test"]


def detect_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            candidate = probe.getsockname()[0]
            if candidate and not candidate.startswith("127."):
                return candidate
    except OSError:
        pass
    return "127.0.0.1"


def build_local_backend_url(port: str) -> str:
    return f"http://{detect_lan_ip()}:{port}"


def normalize_port(raw: Any, fallback: str) -> str:
    text = str(raw).strip() if raw is not None else ""
    candidate = text or fallback
    if not candidate.isdigit():
        return fallback

    port = int(candidate)
    if not 1 <= port <= 65535:
        return fallback
    return str(port)


def validate_port(label: str, raw: str, fallback: str) -> str:
    candidate = (raw or "").strip() or fallback
    if not candidate.isdigit():
        raise ValueError(f"{label} port must be a number between 1 and 65535.")

    port = int(candidate)
    if not 1 <= port <= 65535:
        raise ValueError(f"{label} port must be a number between 1 and 65535.")
    return str(port)


def _replace_url_port(url: str, port: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return url

    auth = ""
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth = f"{auth}:{parsed.password}"
        auth = f"{auth}@"
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = f"{auth}{host}:{port}"
    updated = SplitResult(parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment)
    return urlunsplit(updated)


def normalize_local_backend_url(url: Any, port: str) -> str:
    value = str(url).strip() if url is not None else ""
    if not value or value == LEGACY_LOCAL_URL:
        return build_local_backend_url(port)
    return _replace_url_port(value, port)


def eas_cli_command(*args: str) -> list[str]:
    return [windows_cli_name("npx"), "--yes", "eas-cli@latest", *args]


def default_profiles() -> dict[str, Any]:
    return {
        "active_profile": "local",
        "local": {
            "backend_url": build_local_backend_url(DEFAULT_BACKEND_PORT),
            "shared_token": "codex-dev",
        },
        "live": {
            "backend_url": "",
            "shared_token": "",
        },
        "backend_port": DEFAULT_BACKEND_PORT,
        "expo_port": DEFAULT_EXPO_PORT,
        "eas_profile": DEFAULT_EAS_PROFILE,
    }


def load_profiles() -> dict[str, Any]:
    if not PROFILE_PATH.exists():
        return default_profiles()
    try:
        raw = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        merged = default_profiles()
        merged.update(raw)
        for key in ("local", "live"):
            merged[key].update(raw.get(key, {}))
        merged["backend_port"] = normalize_port(merged.get("backend_port"), DEFAULT_BACKEND_PORT)
        merged["expo_port"] = normalize_port(merged.get("expo_port"), DEFAULT_EXPO_PORT)
        merged["eas_profile"] = str(merged.get("eas_profile") or DEFAULT_EAS_PROFILE).strip() or DEFAULT_EAS_PROFILE
        merged["local"]["backend_url"] = normalize_local_backend_url(
            merged["local"].get("backend_url"),
            merged["backend_port"],
        )
        return merged
    except Exception:
        return default_profiles()


def save_profiles(data: dict[str, Any]) -> None:
    PROFILE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def manifest_path(target: str) -> Path:
    return RUNTIME_DIR / f"{target}.json"


def pid_is_running(pid: int) -> bool:
    result = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return False
    return str(pid) in result.stdout


def read_manifest(target: str) -> dict[str, Any] | None:
    path = manifest_path(target)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def write_manifest(target: str, payload: dict[str, Any]) -> None:
    manifest_path(target).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def remove_manifest(target: str) -> None:
    path = manifest_path(target)
    if path.exists():
        path.unlink()


def windows_cli_name(base: str) -> str:
    return f"{base}.cmd" if os.name == "nt" else base


def target_port(target: str, cfg: dict[str, Any]) -> int | None:
    if target == "backend":
        return int(cfg["backend_port"])
    if target == "expo":
        return int(cfg["expo_port"])
    return None


def pid_for_listening_port(port: int) -> int | None:
    result = subprocess.run(
        ["netstat", "-ano", "-p", "tcp"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None

    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP":
            continue
        local_address = parts[1]
        state = parts[3].upper()
        pid_text = parts[4]
        if not local_address.endswith(f":{port}") or state != "LISTENING":
            continue
        try:
            return int(pid_text)
        except ValueError:
            return None
    return None


def terminate_pid(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            check=False,
            creationflags=CREATE_NO_WINDOW,
        )
        return

    os.kill(pid, signal.SIGTERM)


def target_command(target: str, cfg: dict[str, Any]) -> tuple[list[str], Path]:
    if target == "backend":
        cmd = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(DESKTOP_SERVER_DIR / "start-real-codex-server.ps1"),
            "-HostAddress",
            "0.0.0.0",
            "-Port",
            cfg["backend_port"],
            "-SharedToken",
            cfg[cfg["active_profile"]]["shared_token"] or "codex-dev",
        ]
        cwd = DESKTOP_SERVER_DIR
    elif target == "expo":
        cmd = [
            windows_cli_name("npx"),
            "expo",
            "start",
            "-c",
            "--port",
            cfg["expo_port"],
            "--host",
            "lan",
        ]
        cwd = PHONE_APP_DIR
    elif target == "apk-local":
        cmd = eas_cli_command(
            "build",
            "--platform",
            "android",
            "--local",
            "--profile",
            cfg["eas_profile"],
            "--non-interactive",
        )
        cwd = PHONE_APP_DIR
    else:
        cmd = eas_cli_command(
            "build",
            "--platform",
            "android",
            "--profile",
            cfg["eas_profile"],
            "--non-interactive",
        )
        cwd = PHONE_APP_DIR

    return cmd, cwd


class ControlPanel:
    def __init__(self) -> None:
        self.root = Tk()
        self.root.title("Codex Control Panel")
        self.root.geometry("1220x860")
        self.root.configure(bg="#12070b")

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Card.TFrame", background="#1d0c12")
        style.configure("Card.TLabel", background="#1d0c12", foreground="#fff3f6")
        style.configure("Muted.TLabel", background="#1d0c12", foreground="#d6b7bf")
        style.configure("Accent.TLabel", background="#1d0c12", foreground="#f0a6ba")

        self.cfg = load_profiles()

        self.active_profile = StringVar(value=self.cfg["active_profile"])
        self.local_url = StringVar(value=self.cfg["local"]["backend_url"])
        self.local_token = StringVar(value=self.cfg["local"]["shared_token"])
        self.live_url = StringVar(value=self.cfg["live"]["backend_url"])
        self.live_token = StringVar(value=self.cfg["live"]["shared_token"])
        self.backend_port = StringVar(value=self.cfg["backend_port"])
        self.expo_port = StringVar(value=self.cfg["expo_port"])
        self.eas_profile = StringVar(value=self.cfg["eas_profile"])

        self.status_vars = {target: StringVar(value="Not managed") for target in TARGETS}
        self.log_target = StringVar(value="backend")
        self.message = StringVar(value="")

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.refresh_all()

    def _build_ui(self) -> None:
        container = ttk.Frame(self.root, style="Card.TFrame")
        container.pack(fill="both", expand=True, padx=18, pady=18)

        header = ttk.Frame(container, style="Card.TFrame")
        header.pack(fill="x")
        ttk.Label(
            header,
            text="Crimson Desktop Control",
            style="Accent.TLabel",
            font=("Segoe UI", 26, "bold"),
        ).pack(anchor="w")
        ttk.Label(
            header,
            text="Standalone GUI for process control, builds, and monitoring.",
            style="Muted.TLabel",
            font=("Segoe UI", 11),
        ).pack(anchor="w")

        profiles = ttk.Frame(container, style="Card.TFrame")
        profiles.pack(fill="x", pady=(16, 8))
        profiles.columnconfigure(1, weight=1)
        ttk.Label(profiles, text="Active Profile", style="Accent.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Combobox(
            profiles,
            textvariable=self.active_profile,
            values=["local", "live"],
            state="readonly",
            width=12,
        ).grid(row=0, column=1, padx=8, sticky="w")
        ttk.Button(profiles, text="Apply Profile", command=self.apply_profile).grid(row=0, column=2, padx=8, sticky="w")

        for idx, key in enumerate(("local", "live"), start=1):
            ttk.Label(profiles, text=f"{key.title()} URL", style="Muted.TLabel").grid(row=idx, column=0, sticky="w", pady=2)
            ttk.Entry(profiles, textvariable=self.local_url if key == "local" else self.live_url, width=50).grid(row=idx, column=1, columnspan=2, sticky="we", padx=8)
            ttk.Label(profiles, text=f"{key.title()} Token", style="Muted.TLabel").grid(row=idx + 2, column=0, sticky="w", pady=2)
            ttk.Entry(profiles, textvariable=self.local_token if key == "local" else self.live_token, width=50).grid(row=idx + 2, column=1, columnspan=2, sticky="we", padx=8)

        ports = ttk.Frame(container, style="Card.TFrame")
        ports.pack(fill="x", pady=(10, 8))
        ttk.Label(ports, text="Backend Port", style="Muted.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Entry(ports, textvariable=self.backend_port, width=10).grid(row=0, column=1, padx=6, sticky="w")
        ttk.Label(ports, text="Expo Port", style="Muted.TLabel").grid(row=0, column=2, sticky="w")
        ttk.Entry(ports, textvariable=self.expo_port, width=10).grid(row=0, column=3, padx=6, sticky="w")
        ttk.Label(ports, text="EAS Profile", style="Muted.TLabel").grid(row=0, column=4, sticky="w")
        ttk.Entry(ports, textvariable=self.eas_profile, width=16).grid(row=0, column=5, padx=6, sticky="w")
        ttk.Button(ports, text="Save Settings", command=self.persist_settings).grid(row=0, column=6, padx=8, sticky="w")

        processes = ttk.Frame(container, style="Card.TFrame")
        processes.pack(fill="x", pady=(8, 8))
        for i, target in enumerate(TARGETS):
            card = ttk.Frame(processes, style="Card.TFrame")
            card.grid(row=0, column=i, sticky="nsew", padx=6)
            ttk.Label(card, text=target, style="Accent.TLabel", font=("Segoe UI", 12, "bold")).pack(anchor="w")
            ttk.Label(card, textvariable=self.status_vars[target], style="Muted.TLabel").pack(anchor="w", pady=(2, 8))
            ttk.Button(card, text="Start", command=lambda t=target: self.process_action("start", t)).pack(fill="x")
            ttk.Button(card, text="Stop", command=lambda t=target: self.process_action("stop", t)).pack(fill="x", pady=3)
            ttk.Button(card, text="Restart", command=lambda t=target: self.process_action("restart", t)).pack(fill="x")
            ttk.Button(card, text="Show Log", command=lambda t=target: self.load_log(t)).pack(fill="x", pady=(3, 0))
        for i in range(len(TARGETS)):
            processes.columnconfigure(i, weight=1)

        quick = ttk.Frame(container, style="Card.TFrame")
        quick.pack(fill="x", pady=(6, 8))
        ttk.Label(quick, text="Quick Commands", style="Accent.TLabel").pack(anchor="w")
        row = ttk.Frame(quick, style="Card.TFrame")
        row.pack(fill="x")
        ttk.Button(row, text="npm install", command=lambda: self.quick_command("install")).pack(side="left", padx=(0, 8))
        ttk.Button(row, text="typecheck", command=lambda: self.quick_command("typecheck")).pack(side="left", padx=(0, 8))
        ttk.Button(row, text="logic tests", command=lambda: self.quick_command("test")).pack(side="left", padx=(0, 8))
        ttk.Button(row, text="Refresh All", command=self.refresh_all).pack(side="left")

        ttk.Label(container, textvariable=self.message, style="Muted.TLabel").pack(anchor="w", pady=(2, 6))

        self.log_box = Text(
            container,
            bg="#0f0508",
            fg="#fff3f6",
            insertbackground="#fff3f6",
            height=22,
            wrap="word",
            relief="flat",
        )
        self.log_box.pack(fill="both", expand=True)

    def _read_status(self, target: str) -> dict[str, Any]:
        manifest = read_manifest(target)
        port = target_port(target, self.cfg)
        pid = manifest.get("pid") if manifest else None
        running = bool(pid) and pid_is_running(int(pid))
        blocked_by_pid = None
        if port is not None:
            listening_pid = pid_for_listening_port(port)
            if listening_pid and (not running or listening_pid != pid):
                blocked_by_pid = listening_pid

        if not manifest:
            return {
                "running": False,
                "pid": None,
                "port": port,
                "managed": False,
                "blocked_by_pid": blocked_by_pid,
            }

        return {
            "running": running,
            "pid": pid,
            "port": manifest.get("port", port),
            "managed": manifest.get("managed_by") in (None, MANAGED_BY, PS1_MANAGED_BY),
            "log_path": manifest.get("log_path") or manifest.get("logPath"),
            "stderr_path": manifest.get("stderr_path") or manifest.get("stderrPath"),
            "blocked_by_pid": blocked_by_pid,
        }

    def refresh_all(self) -> None:
        for target in TARGETS:
            status = self._read_status(target)
            if status["running"]:
                self.status_vars[target].set(f"Running | PID {status['pid']} | Port {status['port'] or 'n/a'}")
            elif status.get("blocked_by_pid"):
                self.status_vars[target].set(f"Port {status['port']} busy | External PID {status['blocked_by_pid']}")
            elif status["managed"]:
                self.status_vars[target].set("Stopped")
            else:
                self.status_vars[target].set("Not managed")
        self.load_log(self.log_target.get(), quiet=True)

    def persist_settings(self) -> bool:
        try:
            backend_port = validate_port("Backend", self.backend_port.get(), DEFAULT_BACKEND_PORT)
            expo_port = validate_port("Expo", self.expo_port.get(), DEFAULT_EXPO_PORT)
        except ValueError as exc:
            self.message.set(str(exc))
            messagebox.showerror("Invalid Settings", str(exc))
            return False

        self.cfg["active_profile"] = self.active_profile.get() if self.active_profile.get() in ("local", "live") else "local"
        self.cfg["local"]["backend_url"] = normalize_local_backend_url(self.local_url.get(), backend_port)
        self.cfg["local"]["shared_token"] = self.local_token.get().strip()
        self.cfg["live"]["backend_url"] = self.live_url.get().strip()
        self.cfg["live"]["shared_token"] = self.live_token.get().strip()
        self.cfg["backend_port"] = backend_port
        self.cfg["expo_port"] = expo_port
        self.cfg["eas_profile"] = self.eas_profile.get().strip() or DEFAULT_EAS_PROFILE
        self.local_url.set(self.cfg["local"]["backend_url"])
        self.backend_port.set(backend_port)
        self.expo_port.set(expo_port)
        save_profiles(self.cfg)
        self.message.set("Saved control panel settings.")
        return True

    def apply_profile(self) -> None:
        if not self.persist_settings():
            return
        profile = self.active_profile.get()
        self.message.set(
            f"Profile '{profile}' selected. Saved URL {self.cfg[profile]['backend_url'] or 'unset'} | backend token {self.cfg[profile]['shared_token'] or 'unset'}"
        )

    def _build_target_process(self, target: str) -> tuple[subprocess.Popen[bytes], Path]:
        if not self.persist_settings():
            raise ValueError("Settings must be valid before starting a process.")
        cmd, cwd = target_command(target, self.cfg)
        timestamp = f"{target}-{int(time.time())}"
        stdout_path = RUNTIME_DIR / f"{timestamp}.log"
        stderr_path = RUNTIME_DIR / f"{timestamp}.stderr.log"
        with stdout_path.open("ab") as stdout_file, stderr_path.open("ab") as stderr_file:
            process = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                stdout=stdout_file,
                stderr=stderr_file,
                creationflags=CREATE_NO_WINDOW,
            )
        manifest = {
            "pid": process.pid,
            "port": target_port(target, self.cfg),
            "started_at": str(time.time()),
            "log_path": str(stdout_path),
            "stderr_path": str(stderr_path),
            "managed_by": MANAGED_BY,
            "target": target,
        }
        write_manifest(target, manifest)
        return process, stdout_path

    def process_action(self, action: str, target: str) -> None:
        try:
            if action == "start":
                status = self._read_status(target)
                if status["running"]:
                    self.message.set(f"{target} is already running.")
                    return
                if status.get("blocked_by_pid"):
                    self.message.set(
                        f"Cannot start {target}: port {status['port']} is already in use by external PID {status['blocked_by_pid']}."
                    )
                    return
                process, _ = self._build_target_process(target)
                if target in {"apk-local", "eas-cloud"}:
                    try:
                        exit_code = process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        self.message.set(f"Started {target} with PID {process.pid}.")
                    else:
                        self.message.set(f"{target} exited quickly with code {exit_code}. Check log output.")
                else:
                    self.message.set(f"Started {target} with PID {process.pid}.")
            elif action == "stop":
                self.message.set(self._stop_target(target))
            elif action == "restart":
                self.process_action("stop", target)
                self.process_action("start", target)
                return
            self.refresh_all()
        except Exception as exc:
            self.message.set(f"{action} {target} failed: {exc}")

    def load_log(self, target: str, quiet: bool = False) -> None:
        self.log_target.set(target)
        status = self._read_status(target)
        log_parts: list[str] = []
        for key in ("log_path", "stderr_path"):
            path_value = status.get(key)
            if not path_value:
                continue
            path = Path(str(path_value))
            if path.exists():
                try:
                    text = path.read_text(encoding="utf-8", errors="replace")
                    log_parts.append(f"=== {path.name} ===\n{text}")
                except Exception:
                    pass
        self.log_box.delete("1.0", END)
        self.log_box.insert("1.0", "\n\n".join(log_parts) if log_parts else f"No logs for {target}.")
        if not quiet:
            self.message.set(f"Loaded logs for {target}.")

    def _stop_target(self, target: str) -> str:
        status = self._read_status(target)
        if not status["managed"]:
            if status.get("blocked_by_pid"):
                return (
                    f"{target} is using port {status['port']} via external PID {status['blocked_by_pid']}; "
                    "the panel will not stop external processes."
                )
            return f"{target} is not managed by this panel."

        if status["pid"] and status["running"]:
            try:
                terminate_pid(int(status["pid"]))
            except OSError:
                pass
            remove_manifest(target)
            return f"Stopped {target}."

        remove_manifest(target)
        return f"Cleared saved state for {target}."

    def on_close(self) -> None:
        running_targets = [target for target in TARGETS if self._read_status(target)["running"]]
        if running_targets:
            names = ", ".join(running_targets)
            should_stop = messagebox.askyesnocancel(
                "Close Control Panel",
                f"Managed processes are still running: {names}\n\nYes: stop them before exit.\nNo: leave them running and reconnect next time.\nCancel: keep the window open.",
            )
            if should_stop is None:
                return
            if should_stop:
                for target in running_targets:
                    self._stop_target(target)

        self.root.destroy()

    def quick_command(self, command: QuickCommand) -> None:
        if not self.persist_settings():
            return
        command_map = {
            "install": [windows_cli_name("npm"), "install"],
            "typecheck": [windows_cli_name("npm"), "run", "typecheck"],
            "test": [windows_cli_name("npm"), "run", "test:logic"],
        }
        label = {
            "install": "npm install",
            "typecheck": "typecheck",
            "test": "logic tests",
        }[command]
        result = subprocess.run(
            command_map[command],
            cwd=str(PHONE_APP_DIR),
            capture_output=True,
            text=True,
            creationflags=CREATE_NO_WINDOW,
            check=False,
        )
        output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip() or "No output."
        self.log_box.delete("1.0", END)
        self.log_box.insert("1.0", output)
        self.message.set(f"Ran quick command: {label} (exit {result.returncode}).")

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    ControlPanel().run()
