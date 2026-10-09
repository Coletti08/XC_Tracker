# XC Tracker

This project is a live cross-country race tracking system designed to make races easier to follow for spectators and coaches. Runners carry small GPS trackers that transmit their locations over LoRa radio to a receiver connected to a laptop. The application will display their positions on a preloaded course map in a Mario Kart-style view, showing relative positions, splits, and gaps between runners. It also saves tracking sessions for download and later analysis, helping coaches review performance and race strategy.

<img width="1654" height="1760" alt="Screenshot 2026-10-08 at 11 12 18 PM" src="https://github.com/user-attachments/assets/4d2cb86b-6583-409d-983d-e90e6b5ef0cc" />


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


## Connection:

- connect USB receiver node
- Load USB node through **Live Recordings** page
- verify packets are being received if not see debug


## Receiver Node Debug:
- Run the command below from / and monitor messages
```
.venv/bin/python -m meshtastic \
  --port /dev/cu.usbmodemXXXX \ 
  --listen
```

- Replace XXX with port shown in Live Data:

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


