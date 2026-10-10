from django.urls import path
from api.views import health, import_recording
from api.tracker import views as tracker
from api.racing import views as racing

urlpatterns = [
    path("api/racing/", racing.catalog),
    path("api/racing/courses/", racing.create_course),
    path("api/racing/courses/import/", racing.import_course),
    path("api/racing/courses/<int:course_id>/export/", racing.export_course),
    path("api/racing/races/", racing.create_race),
    path("api/racing/races/<int:race_id>/", racing.race_detail),
    path("api/racing/races/<int:race_id>/action/", racing.race_action),
    path("api/racing/races/<int:race_id>/simulate/", racing.simulate),
    path("api/racing/races/<int:race_id>/export/", racing.export_race),
    path("api/health/", health, name="health"),
    path("api/recordings/import/", import_recording, name="import-recording"),
    path("api/tracker/ports/", tracker.ports, name="tracker-ports"),
    path("api/tracker/connect/", tracker.connect, name="tracker-connect"),
    path("api/tracker/disconnect/", tracker.disconnect, name="tracker-disconnect"),
    path(
        "api/tracker/sessions/<int:session_id>/delete/",
        tracker.delete_session,
        name="tracker-session-delete",
    ),
    path("api/tracker/sessions/", tracker.sessions, name="tracker-sessions"),
    path(
        "api/tracker/sessions/<int:session_id>/download/",
        tracker.download_session,
        name="tracker-session-download",
    ),
    path("api/tracker/packets/", tracker.packets, name="tracker-packets"),
]
