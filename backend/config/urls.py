from django.urls import path
from api.views import health, import_recording
from api.tracker import views as tracker

urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/recordings/import/", import_recording, name="import-recording"),
    path("api/tracker/ports/", tracker.ports, name="tracker-ports"),
    path("api/tracker/connect/", tracker.connect, name="tracker-connect"),
    path("api/tracker/disconnect/", tracker.disconnect, name="tracker-disconnect"),
    path("api/tracker/sessions/", tracker.sessions, name="tracker-sessions"),
    path("api/tracker/sessions/<int:session_id>/download/", tracker.download_session, name="tracker-session-download"),
    path("api/tracker/packets/", tracker.packets, name="tracker-packets"),
]
