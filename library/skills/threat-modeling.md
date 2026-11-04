# Threat modeling

Use when a change adds an attack surface: a new endpoint, integration, webhook, file upload, permission or trust boundary.

1. Draw what crosses the boundary: who can send what, and what they can reach if it is malformed or malicious.
2. For each crossing, ask: can they pretend to be someone else, change data, deny having done it, read what they should not, stop the service, or gain rights?
3. Write each real threat as one line: attacker, action, impact, and the control that stops it, or `none` if there is no control yet.
4. A threat with no control is a finding. A control with no test is a finding.

Keep it to the threats this change creates. A generic list helps nobody.
