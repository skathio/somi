# Deployment notes

The service runs behind one load balancer that we operate, so `remote` is always the load balancer's address. The load balancer appends the address it saw to `x-forwarded-for`. Anything before the last entry came from the client and can say anything. There is always at least one entry in production, and when there is none, as in tests on a laptop, `remote` is the client.

Limits and quotas belong to the customer, so a client with an API key we issued is counted by that key, wherever it connects from. Anyone else is counted by address.

The load balancer probes `GET /health` several times a second and must never be refused.
