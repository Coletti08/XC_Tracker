# XC Tracker

A laptop development starter: one React page, a Django API, and a launcher.
The page checks the backend connection through `GET /api/health/`.

## First-time setup

Install Python 3.12 and Node.js 22.12 (including npm).

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

## Launch

```sh
python3 launcher.py
```

On Windows, use `py launcher.py`.

The launcher uses `.venv`, starts both servers, and opens
<http://127.0.0.1:5173>. 

Both servers listen only on this laptop. This is a local development setup!!!

## To-Do:

#### setup:
```
  CSV imports ✅
  graph for positions relative to start ✅
  first iteration map generation ✅
  save map for future displays and comparison ❌ --bugs 
  stack maps for replay comparison
```

#### Important:
```
connect to a network
parse position data from a device



```

#### clean up / testing:
```
```


