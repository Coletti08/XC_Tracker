"""A single, explicitly opened USB receiver owned by the local Django process."""

import atexit
import logging
from queue import Empty, Full, Queue
import threading

from django.db import close_old_connections, connections
from django.utils import timezone
from meshtastic.serial_interface import SerialInterface
from pubsub import pub
from serial.tools import list_ports

from api.models import TrackerPacket
from .packets import normalize_packet

logger = logging.getLogger(__name__)


def available_ports():
    return [
        {"device": port.device, "description": port.description or port.device}
        for port in sorted(list_ports.comports(), key=lambda item: item.device)
    ]


class ReceiverBusy(Exception):
    pass


class TrackerReceiver:
    def __init__(self):
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = None
        self._interface = None
        self._pending = Queue(maxsize=1000)
        self._status = {
            "state": "disconnected",
            "port": None,
            "connected_at": None,
            "receiver_id": None,
            "error": None,
            "capture_error": None,
            "dropped_packets": 0,
        }

    def status(self):
        with self._lock:
            return dict(self._status)

    def connect(self, port):
        with self._lock:
            if self._thread and self._thread.is_alive():
                raise ReceiverBusy("Disconnect the current receiver before connecting again.")

            self._stop = threading.Event()
            self._pending = Queue(maxsize=1000)
            self._status.update(
                state="connecting", port=port, connected_at=None, receiver_id=None,
                error=None, capture_error=None, dropped_packets=0,
            )
            self._thread = threading.Thread(
                target=self._run, args=(port,), daemon=True, name="xc-tracker-receiver",
            )
            self._thread.start()
            return dict(self._status)

    def disconnect(self):
        with self._lock:
            self._stop.set()
            if self._thread and self._thread.is_alive():
                self._status["state"] = "stopping"
            else:
                self._status.update(state="disconnected", error=None)
            return dict(self._status)

    def _receive(self, packet, interface):
        # PubSub is global; ignore any other SDK interface in this process.
        with self._lock:
            if interface is not self._interface or self._stop.is_set():
                return

        try:
            values = normalize_packet(packet, interface)
            values["received_at"] = timezone.now()
            self._pending.put_nowait(values)
        except Full:
            with self._lock:
                self._status["dropped_packets"] += 1
                self._status["capture_error"] = "Packet queue is full. Some packets were not saved."
        except Exception:
            logger.exception("Could not decode a tracker packet")
            with self._lock:
                self._status["dropped_packets"] += 1
                self._status["capture_error"] = "A packet could not be decoded. Check the backend output."

    def _save(self, values):
        try:
            close_old_connections()
            TrackerPacket.objects.create(**values)
        except Exception:
            logger.exception("Could not save a tracker packet")
            with self._lock:
                self._status["dropped_packets"] += 1
                self._status["capture_error"] = "A packet could not be saved. Check disk space and backend output."

    def _run(self, port):
        interface = None
        failure = None
        pub.subscribe(self._receive, "meshtastic.receive")

        try:
            # Assign before the handshake so early received packets are captured.
            interface = SerialInterface(devPath=port, connectNow=False, timeout=15)
            with self._lock:
                self._interface = interface

            if not self._stop.is_set():
                interface.connect()

            if not self._stop.is_set():
                info = getattr(interface, "myInfo", None)
                node_num = getattr(info, "my_node_num", None)
                with self._lock:
                    self._status.update(
                        state="connected", connected_at=timezone.now().isoformat(),
                        receiver_id=f"!{node_num:08x}" if node_num is not None else None,
                    )

            while not self._stop.is_set():
                if not interface.isConnected.is_set():
                    raise ConnectionError("USB receiver disconnected. Reconnect it and press Connect.")

                try:
                    self._save(self._pending.get(timeout=0.25))
                except Empty:
                    continue
        except Exception as error:
            logger.warning("Tracker receiver stopped: %s", error)
            failure = f"{error}. Check the USB cable, Meshtastic firmware, and whether another app is using the port."
        finally:
            pub.unsubscribe(self._receive, "meshtastic.receive")
            with self._lock:
                self._interface = None

            if interface is not None:
                self._close(interface)

            # Finish already accepted events when the user disconnects or USB is lost.
            while True:
                try:
                    self._save(self._pending.get_nowait())
                except Empty:
                    break

            connections.close_all()
            with self._lock:
                self._status.update(
                    state="error" if failure and not self._stop.is_set() else "disconnected",
                    error=failure if not self._stop.is_set() else None,
                )

    @staticmethod
    def _close(interface):
        try:
            interface.close()
        except Exception:
            # SerialInterface.close can fail while flushing an unplugged device.
            logger.debug("Closing an unavailable USB device", exc_info=True)
        finally:
            timer = getattr(interface, "heartbeatTimer", None)
            if timer:
                timer.cancel()
            stream = getattr(interface, "stream", None)
            if stream:
                try:
                    stream.close()
                except Exception:
                    logger.debug("USB stream already unavailable", exc_info=True)


receiver = TrackerReceiver()
atexit.register(receiver.disconnect)
