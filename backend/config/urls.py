from django.urls import path
from api.views import health, import_recording

urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/recordings/import/", import_recording, name="import-recording"),
]