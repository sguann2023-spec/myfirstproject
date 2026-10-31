# Chat History Persistence

## Rendering First

AI reply events are forwarded to the renderer immediately. Database acknowledgements
must not gate runtime dispatch, text rendering, question cards, submission, or stream
completion. UI state and persisted history are not required to be identical.

History persistence is best effort. Writes are submitted per event to an independent
ordered queue, with event-time payloads captured before later events can mutate them.
Database errors are logged and must not abort the reply or suppress user interaction.
There are no periodic reply snapshots. Shutdown or process termination may lose
queued history, including content already visible in the UI; this is accepted.

Message completion resolves when the reply completes, fails, or is cancelled,
independently of the history writer. Runtime lifecycle guards must not wait for
history writes. An optional history notification may trigger a background refresh;
it is never a prerequisite for rendering, completion, scheduling, or user interaction.
