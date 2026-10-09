from django.db import models
from django.utils import timezone


class TrackerPacket(models.Model):
    """One received event, including its original decoded payload."""

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
            "received_at": self.received_at.isoformat(),
            "node_id": self.node_id,
            "packet_type": self.packet_type,
        }
