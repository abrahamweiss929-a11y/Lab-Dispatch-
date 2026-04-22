# interfaces/

TypeScript interface declarations — the "ports" — for every external service the app talks to: SMS, inbound email, AI parser, maps, storage. Only type declarations live here; concrete implementations belong in `lib/`, and test fakes belong in `mocks/`.
