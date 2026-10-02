# Restoring from a backup

Use this when a notebook folder was deleted or damaged.

1. Close Lantern on every device, so nothing writes while you restore.
2. Copy the notebook folder from the latest backup into place.
3. Start Lantern and choose **Rebuild index**. The index is only a cache, as
   [ADR-0001](../decisions/0001-store-notes-as-plain-files.md) explains, so
   nothing is lost by rebuilding it.
4. Open the [[notebook]] and spot-check the most recent notes.
5. Re-open Lantern on the other devices one at a time.

Back to the [docs home](../Home.md).
