# Packed React consumer dependencies

The fixture uses exact versions and committed lockfiles. Install with
`--ignore-scripts`; none of these dependencies is shipped by bugbottle.

The React 18 additions were inspected through npm registry metadata and
published tarball JavaScript on 2026-11-03, before installation:

| Package | Version | Published | Maintainer / purpose |
| --- | --- | --- | --- |
| react | 18.3.1 | 2024-04-26 | Meta React team, established React runtime |
| react-dom | 18.3.1 | 2024-04-26 | Meta React team, DOM renderer |
| scheduler | 0.23.2 | 2024-04-26 | Meta React team, renderer scheduling |
| loose-envify | 1.4.0 | 2018-07-10 | zertosh, environment transform |
| js-tokens | 4.0.0 | 2018-01-28 | lydell, tokenisation for loose-envify |
| @types/react | 18.3.12 | 2024-10-23 | DefinitelyTyped, React 18 declarations |
| @types/prop-types | 15.7.15 | 2025-06-09 | DefinitelyTyped, declarations only |
| csstype | 3.2.3 | 2025-11-17 | anders.ekdahl/faddee, CSS declarations |

React, React DOM and scheduler read `process.env.NODE_ENV` to choose their
development builds. loose-envify reads environment variables for its transform.
No load-time network requests were found in these packages. There are no
install lifecycle scripts; react-dom's `start`, loose-envify's test scripts and
csstype's development/prepublish scripts are not needed. All selected versions
are older than three days. React 18 uses three runtime transitive packages (scheduler, loose-envify and
js-tokens) and two declaration dependencies (csstype and @types/prop-types).
The latter two do not execute at runtime.

React/React DOM 19.3.0, @types/react 19.3.0, happy-dom 20.14.5 and TypeScript
5.9.3 already belong to the repository's locked development graph. The fixtures
pin happy-dom's Node/ws types and ws to the existing repository versions to
avoid unrelated transitive upgrades. React 19 adds no packages beyond that
graph. No new repository development dependency is required.

Conclusion: **install with `--ignore-scripts`**. Lockfiles keep future fixture
runs on the audited graph; changing their versions requires another audit.
