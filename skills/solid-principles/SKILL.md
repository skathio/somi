---
name: solid-principles
description: Use when designing a new module, naming a class, deciding what a function should know, splitting/merging modules, or evaluating whether an abstraction is paying for itself. Operationalizes SOLID as design questions, not five recited bullets.
---

# SOLID — design questions

The principles are in [`rules/10-solid.md`](../../rules/10-solid.md) — that's the always-on floor.
This skill adds **operational depth**: before/after example pairs, decision rules, anti-patterns.
Don't restate the rule's prose here; link to it when the principle itself is the answer.

When you load this skill you are evaluating a design, not reciting principles. Each letter is a question
to ask of the code you're about to write or review.

## S — "What's the one reason this changes?"

If you can't say it in one sentence without "and", you have an SRP problem. SRP isn't about counting
methods; it's about counting **actors** that drive change.

**Before (SRP smell)**
```python
class Order:
    def total(self) -> Money: ...
    def save(self) -> None: ...         # persistence
    def send_receipt(self) -> None: ...  # email
```

Three reasons to change: pricing rules, schema, comms.

**After**
```python
class Order:                   # pricing rules
    def total(self) -> Money: ...

class OrderRepository:         # persistence
    def save(self, o: Order) -> None: ...

class ReceiptSender:           # comms
    def send(self, o: Order) -> None: ...
```

## O — "Can I add the next variant without editing existing code?"

OCP isn't "make everything pluggable." It's "when the next variant arrives, design lets you *add* instead
of *modify*." Only invest when variation is real.

**The three-cases rule**: do not abstract until you have three concrete variants. Two is a coincidence;
three is a pattern. A premature strategy interface costs more than a third `if`.

## L — "Does this subtype obey the parent's contract, or weaken it?"

The Square/Rectangle case is the canonical example. If your subclass throws `NotSupportedException`,
the type relationship is wrong — prefer composition.

**Red flag:** when a subclass override requires callers to *check the runtime type* to know what to do,
the inheritance is misused.

## I — "Is this interface shaped for callers, or for the implementer's convenience?"

Big "service" interfaces (`IUserService` with 20 methods) usually serve the implementer. Callers
typically need 2–3 of those methods. Split:

**Before**
```ts
interface UserService {
  getUser(id: string): User
  updateProfile(id: string, p: Profile): void
  resetPassword(id: string): void
  exportGDPRData(id: string): Blob
  // ... 15 more
}
```

**After**
```ts
interface UserReader  { getUser(id: string): User }
interface ProfileWriter { updateProfile(id: string, p: Profile): void }
interface PasswordResetter { resetPassword(id: string): void }
interface GDPRExporter { exportGDPRData(id: string): Blob }
```

Each consumer depends on the role it actually uses. The concrete `UserService` implements all four.

## D — "Does business policy know about mechanism?"

Domain rules should not import database drivers, HTTP clients, file systems, or cloud SDKs. The domain
declares the interface in its own language; infrastructure implements it.

**Smell**
```python
# domain/order.py
import psycopg2
def reserve_inventory(order):
    conn = psycopg2.connect(...)
    ...
```

**Better**
```python
# domain/inventory.py
class InventoryPort(Protocol):
    def reserve(self, sku: str, qty: int) -> None: ...

# domain/order.py
def reserve_inventory(order, inventory: InventoryPort):
    for line in order.lines:
        inventory.reserve(line.sku, line.qty)

# infrastructure/postgres_inventory.py
class PostgresInventory(InventoryPort):
    def __init__(self, conn): self.conn = conn
    def reserve(self, sku, qty): ...
```

Now domain tests don't need a database. Now the inventory implementation can change without touching the
order policy.

But: **don't invert dependencies you never swap.** A `LoggerInterface` with one logger implementation is
just extra indirection.

## Meta-rules

See [`rules/10-solid.md`](../../rules/10-solid.md) §Meta-rules for the canonical statements
(YAGNI > SOLID for hypothetical variation; three-is-the-magic-number; refactor-under-green).
Operational additions specific to this skill:

- **Composition over inheritance** in ~80% of cases; reserve inheritance for true is-a relationships
  whose contract genuinely holds across subtypes (re-read the L section before reaching for `extends`).

## When SOLID is *not* the right lens

- **One-off scripts.** A bash script doesn't need DI.
- **Performance-critical inner loops.** Sometimes the right move is a flat struct + tight loop, not
  five tiny objects.
- **Trivial code paths.** A three-line function doesn't need a class hierarchy.

SOLID is a response to real change pressure. If there's no pressure, the principles are inert.

## When to escalate

If you spot a SOLID violation that's deeper than this skill can fix — for example, the dependency
direction is wrong throughout a layer — escalate to [`architecture-reviewer`](../../agents/architecture-reviewer.md)
rather than patching locally.
