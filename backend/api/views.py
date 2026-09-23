from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_GET, require_POST

from .csv_import import ImportError, MAX_BYTES, parse_recording


@require_GET
def health(request):
    response = JsonResponse({"status": "ok", "service": "XC Tracker backend", "csrf_token": get_token(request)})
    response["Cache-Control"] = "no-store"
    return response


@require_POST
def import_recording(request):
    upload = request.FILES.get("file")
        return JsonResponse({"error": "Choose a CSV file to import."}, status=400)
    if not upload.name.lower().endswith(".csv"):
        return JsonResponse({"error": "Choose a .csv file. Unzip Sensor Logger exports first, then select Location.csv."}, status=400)
    if upload.size > MAX_BYTES:
        return JsonResponse({"error": "This file is too large. Use a CSV smaller than 10 MB."}, status=413)
    try:
        recording = parse_recording(upload.read(MAX_BYTES + 1), upload.name)
    except ImportError as error:
        return JsonResponse({"error": str(error)}, status=400)
    response = JsonResponse(recording, json_dumps_params={"allow_nan": False})
    response["Cache-Control"] = "no-store"
    return response
