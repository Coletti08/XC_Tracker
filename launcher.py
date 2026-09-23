"""Launch the local frontend and backend. Ctrl+C stops both."""
import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:5173"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not python.exists() or not (ROOT / "frontend/node_modules").exists():
        parser.exit(1, "Complete the first-time setup in README.md, then launch again.\n")
    if not npm:
        parser.exit(1, "Install Node.js 22.12+ with npm, then open a new terminal.\n")

    frontend = [npm, "run", "dev"]
    if os.name == "nt":
        frontend = [os.environ.get("COMSPEC", "cmd.exe"), "/c", *frontend]
    commands = [
        ([str(python), "manage.py", "runserver", "127.0.0.1:8000", "--noreload"], ROOT / "backend"),
        (frontend, ROOT / "frontend"),
    ]

    processes = []
    exit_code = 0
    print(f"Starting XC Tracker at {URL}. Ctrl+C stops both servers.", flush=True)

    try:
        for command, cwd in commands:
            options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
            processes.append(subprocess.Popen(command, cwd=cwd, **options))
        ready = False
        started = time.monotonic()

        while True:
            if any(process.poll() is not None for process in processes):
                print("A server stopped. Check its output above (ports 5173 and 8000 must be free).")
                exit_code = 1
                break

            if not ready:
                try:
                    with urlopen(f"{URL}/api/health/", timeout=0.5) as response:
                        ready = response.status == 200
                except (URLError, TimeoutError, ConnectionError):
                    pass


                if ready:
                    print(f"Ready: {URL}", flush=True)
                    if not args.no_browser:
                        webbrowser.open(URL)

                elif time.monotonic() - started > 30:
                    print("Startup timed out. Check the server output above.")
                    exit_code = 1
                    break
                
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nStopping XC Tracker…")
    except OSError as error:
        print(f"Could not start XC Tracker: {error}")
        exit_code = 1
    finally:
        for process in processes:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    process.kill()
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

