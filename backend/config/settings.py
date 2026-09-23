"""Settings for local development on a laptop."""
import os

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "xc-tracker-local-development-only")
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
# Vite forwards the browser's Origin while proxying uploads to Django on 8000.
CSRF_TRUSTED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"]
INSTALLED_APPS = ["api"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
USE_TZ = True
TIME_ZONE = "UTC"
