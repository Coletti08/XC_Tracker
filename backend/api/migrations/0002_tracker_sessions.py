import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


def preserve_history(apps, schema_editor):
    Packet = apps.get_model("api", "TrackerPacket")
    Session = apps.get_model("api", "TrackerSession")
    packets = Packet.objects.using(schema_editor.connection.alias)
    first = packets.order_by("received_at").first()
    if first:
        last = packets.order_by("-received_at").first()
        session = Session.objects.using(schema_editor.connection.alias).create(
            started_at=first.received_at, ended_at=last.received_at,
            status="legacy", port="Previous captures",
        )
        packets.update(session_id=session.pk)


class Migration(migrations.Migration):
    dependencies = [("api", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="TrackerSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("started_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("connected_at", models.DateTimeField(null=True)),
                ("ended_at", models.DateTimeField(null=True)),
                ("port", models.CharField(blank=True, max_length=255)),
                ("receiver_id", models.CharField(max_length=80, null=True)),
                ("status", models.CharField(db_index=True, default="open", max_length=20)),
                ("error", models.TextField(null=True)),
                ("capture_error", models.TextField(null=True)),
                ("dropped_packets", models.PositiveIntegerField(default=0)),
            ],
            options={"ordering": ["-id"]},
        ),
        migrations.AddField(
            model_name="trackerpacket", name="session",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="packets", to="api.trackersession"),
        ),
        migrations.RunPython(preserve_history, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="trackerpacket", name="session",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="packets", to="api.trackersession"),
        ),
    ]
