from django.db import models
from django.utils import timezone


class TrackerSession(models.Model):
    """A connection attempt and every packet captured before it closes."""

    started_at = models.DateTimeField(default=timezone.now)
    connected_at = models.DateTimeField(null=True)
    ended_at = models.DateTimeField(null=True)
    port = models.CharField(max_length=255, blank=True)
    receiver_id = models.CharField(max_length=80, null=True)
    status = models.CharField(max_length=20, default="open", db_index=True)
    error = models.TextField(null=True)
    capture_error = models.TextField(null=True)
    dropped_packets = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-id"]

    def as_dict(self):
        return {
            "id": self.pk,
            "started_at": self.started_at.isoformat(),
            "connected_at": (
                self.connected_at.isoformat() if self.connected_at else None
            ),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "port": self.port,
            "receiver_id": self.receiver_id,
            "status": self.status,
            "error": self.error,
            "capture_error": self.capture_error,
            "dropped_packets": self.dropped_packets,
            "packet_count": getattr(self, "packet_count", None),
        }


class TrackerPacket(models.Model):
    """One received event, including its original decoded payload."""

    session = models.ForeignKey(
        TrackerSession, on_delete=models.PROTECT, related_name="packets"
    )
    received_at = models.DateTimeField(default=timezone.now, db_index=True)
    node_id = models.CharField(max_length=80, db_index=True)
    packet_type = models.CharField(max_length=80)
    data = models.JSONField()

    class Meta:
        ordering = ["-id"]

    def as_dict(self):
        return {
            **self.data,
            "id": self.pk,
            "session_id": self.session_id,
            "received_at": self.received_at.isoformat(),
            "node_id": self.node_id,
            "packet_type": self.packet_type,
        }


class Course(models.Model):
    name = models.CharField(max_length=100)
    geometry = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now)


class Race(models.Model):
    name = models.CharField(max_length=100)
    course = models.ForeignKey(Course, on_delete=models.PROTECT)
    course_snapshot = models.JSONField()
    roster = models.JSONField(default=list)
    settings = models.JSONField(default=dict)
    mode = models.CharField(max_length=12, default="live")
    state = models.CharField(max_length=12, default="draft")
    started_at = models.DateTimeField(null=True)
    ended_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(default=timezone.now)
    simulation_s = models.FloatField(default=0)


class RaceEvent(models.Model):
    race = models.ForeignKey(Race, on_delete=models.CASCADE, related_name="events")
    packet = models.ForeignKey(TrackerPacket, null=True, on_delete=models.PROTECT)
    node_id = models.CharField(max_length=80)
    elapsed_s = models.FloatField()
    data = models.JSONField()

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["race", "packet"], name="unique_race_packet"
            )
        ]
