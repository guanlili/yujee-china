# @smalldog/design-agent

Design-agent application shell.

This package is the place for product-specific design behavior:

- design system prompt
- design tools
- design resources
- runtime/session policy
- print, RPC, and interactive modes

The universal agent loop lives in `packages/agent`; avoid changing it unless the design agent needs a generic capability.
