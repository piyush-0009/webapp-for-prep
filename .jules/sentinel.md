## 2026-10-20 - Sanitize innerHTML injections
**Vulnerability:** XSS via unsanitized variables interpolated into innerHTML strings.
**Learning:** Found multiple instances where user inputs were directly injected into DOM via template literals inside innerHTML assignments.
**Prevention:** Always use an `escapeHTML` helper function to sanitize user inputs before interpolating them into strings meant for `innerHTML` or equivalent properties.
