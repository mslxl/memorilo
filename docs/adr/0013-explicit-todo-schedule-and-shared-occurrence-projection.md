# Explicit Todo schedules and one shared occurrence projection

Status: accepted

Memorilo will replace the ambiguous Todo schedule field combinations with an explicit `none`/`deadline`/`span` model in one breaking migration. The in-app Todo calendar and the external ICS feed will consume one shared pure occurrence projection, including the same holiday, lunar, custom, and completion-based recurrence semantics; this avoids two interpretations of the same Todo and prevents speculative completion-based occurrences from appearing outside the app.
