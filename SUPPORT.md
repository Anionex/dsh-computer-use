# Support

## Start here

Read [README.md](README.md) for installation, protocol semantics, macOS permissions, Tool behavior, stable errors, security, and limitations. The repository's deterministic fixture is the preferred reproduction target.

## Ask a usage question

Use the repository's **Usage question** issue form for reproducible installation, permission, configuration, or workflow questions. Include:

- plugin version or commit and DeepSeek Harness version;
- Web or Headless Profile;
- macOS version and Apple silicon or Intel hardware;
- Node.js and pnpm versions;
- Accessibility and Screen Recording state;
- exact Tool sequence and sanitized stable error code.

Do not include credentials, screenshots of private applications, customer data, secure-field values, or identifying bundle ids. Reproduce with the fixture or another disposable application whenever possible.

## Report a bug

Use the structured **Bug report** form. State whether a fresh observation was used, whether the action was semantic or coordinate-based, and whether the returned state confirmed any input. Never infer success from a timeout or provider failure.

## Security and private reports

Suspected vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public issue. The project does not promise private product support, roadmap priority, or a response-time SLA.

## Scope boundaries

- DSH runtime, approval, sandbox, and Agent-loop defects belong in the DeepSeek Harness repository.
- Browser tasks belong in the browser automation capability unless the task requires native UI.
- Visual understanding and grounding defects belong in `dsh-vision-toolkit` unless this bundle misuses the public result.
- Application-specific business workflows belong in a domain bundle such as `dsh-design`.
