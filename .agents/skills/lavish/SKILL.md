---
name: lavish
description: Turn complex plans, comparisons, diagrams, reports, and decision-heavy responses into a local HTML artifact reviewable with lavish-axi.
argument-hint: <what to visualize>
---

# Lavish workflow

Use this skill when a response is easier to review visually than as prose.

1. Create an HTML artifact under `.lavish/`.
2. Open it with:

   ```sh
   npx -y lavish-axi .lavish/<name>.html
   ```

3. If the user wants interactive feedback, poll in the foreground:

   ```sh
   npx -y lavish-axi poll .lavish/<name>.html --agent-reply "What to review first"
   ```

4. Apply feedback, update the artifact, and poll again as needed.
5. End the session when done:

   ```sh
   npx -y lavish-axi end .lavish/<name>.html
   ```

Rules:

- Keep artifacts local-first and portable.
- Use relative asset paths next to the HTML file.
- Use Mermaid for architecture/flow diagrams when appropriate.
- Fix any layout warnings returned by `poll` before asking for human review.
- Do not background `poll` unless the harness has a verified wake/completion path.
