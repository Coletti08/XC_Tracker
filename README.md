# XC Tracker — minimal starter

A laptop development starter: one React page, a Django API, and a launcher.
The page checks the backend connection through `GET /api/health/`.

## First-time setup

Install Python 3.12+ and Node.js 22.12+ (including npm).

**macOS / Linux**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r XC_Tracker/backend/requirements.txt
npm --prefix frontend ci
```

**Windows (PowerShell or Command Prompt)**

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`.

## Launch

```sh
python3 launcher.py
```

On Windows, use `py launcher.py`.

The launcher uses `.venv`, starts both servers, and opens
<http://127.0.0.1:5173>. Keep the terminal open; **Ctrl+C** stops both servers.
Use `--no-browser` to skip opening the browser.

Both servers listen only on this laptop. This is a local development setup.


