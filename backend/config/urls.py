from django.urls import path
from api.views import health

urlpatterns = [
    path("api/health/", health, name="health"),
]

