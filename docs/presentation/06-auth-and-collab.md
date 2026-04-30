# Auth + Live Collab

End-to-end walkthrough of the GitHub OAuth + JWT auth flow and the
WebSocket-based real-time collab feature. Two screenshots back this up:

- `screenshots/Ollama.png` -- single user, guest mode, agent driving Qwen 3
- `screenshots/live-collab.png` -- two real GitHub users authenticated
  through OAuth, both connected to the lab Hub via WebSocket

## OAuth flow (GitHub -> Hub -> CLI)

The CLI never talks to GitHub directly. The Hub is the OAuth client;
the CLI just owns the loopback redirect.

```
1. CLI (./run.sh)            -> spawns ephemeral 127.0.0.1:N listener
2. CLI                        -> opens browser to:
                                  HUB/auth/github?redirect=http://127.0.0.1:N/cb
3. Browser -> Hub /auth/github
4. Hub                        -> verifies redirect is loopback (security)
                                  generates CSRF state, stores it
                                  302 -> github.com/login/oauth
5. Browser -> GitHub          -> user approves
6. GitHub -> Hub /auth/github/callback?code&state
7. Hub                        -> validates state, exchanges code for
                                  access_token, fetches user info
                                  issues JWT (HS256, 7d TTL) signed
                                  with JWT_SECRET
8. Hub                        -> 302 -> http://127.0.0.1:N/cb?token=JWT
9. Browser -> CLI listener
10. CLI listener              -> writes ~/.godpherhack/auth.json (mode 0600)
                                  closes listener
                                  resolves the original promise
11. CLI UI                    -> "Signed in as @login (Display Name)"
                                  proceeds to provider picker
```

Properties worth calling out:

- **Loopback-only redirect** -- the Hub rejects any redirect URI that
  isn't `127.0.0.1` or `localhost`. Without this, an attacker could
  point `?redirect=https://attacker.example` and have the Hub mint a
  real signed JWT into their hands.
- **CSRF state** -- random UUID stored server-side, validated on
  callback. 5-minute TTL, GC'd on a 60s timer, capped at 1000 entries.
- **JWT contents** -- claims are `{sub, login, name, email,
  avatarUrl}`. Hub verifies signature on every request via the
  `requireJwt` middleware (Zod-validated, not just `as` casts).
- **No password DB** -- GitHub IDs are the identity. Adding/removing
  users is just admin curation of who's allowed to authenticate
  (currently anyone with GitHub).

## Public vs authenticated routes

`requireJwt` uses an **exact-match** allowlist (not a prefix match)
to avoid accidentally exposing future `/auth/<something>` routes:

```
public:    /health, /metrics, /auth/github, /auth/github/callback
public:    /ws/*  (handled out of band before the HTTP stack)
private:   /challenges/*, /solves, /auth/me
```

## Anonymous mode (and why it requires opt-in)

If `JWT_SECRET + GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET` aren't set,
the Hub **refuses to start** unless `ALLOW_ANONYMOUS_HUB=true` is also
set. This deliberate fail-closed default exists because the original
design booted silently in anon mode if any auth env var was missing,
and "forgot to set JWT_SECRET, oops it's open" is the failure mode you
want to make impossible.

`scripts/smoke.sh` sets `ALLOW_ANONYMOUS_HUB=true` explicitly for
hermetic load testing.

## Live collab (WebSocket)

Auth gives you identity. Collab uses that identity for two things:
**presence** (who's online + what they're doing) and **agent event
broadcast** (everyone sees what everyone else's agent is doing).

```
CollabClient (in CLI)         CollabHub (in Hub)
    |                              |
    |--- ws connect /ws/collab --->|
    |                              | accepts upgrade, opens WS
    |--- {type:"auth", token} --->|
    |                              | jose.verify(token), Zod-parse claims
    |<-- {type:"auth.ok", user} ---|
    |<-- {type:"feed.snapshot",    |
    |       events: [...]} --------|  (last 100 agent events)
    |                              |
    |--- {type:"presence",         |
    |       activity, ...} ------>|  every 10s heartbeat + on activity change
    |                              |
    |--- {type:"agent.event",      |
    |       runId, event} -------->|  during active agent runs
    |                              | broadcasts to all OTHER clients:
    |<-- {type:"feed.event",       |
    |       userId, runId, ...} ---|
    |<-- {type:"presence.update",  |
    |       users: [...]} ---------|  on any user join/leave/activity change
```

## Lifecycle and integrity

A handful of things had to be right for the screenshot to actually
work end to end:

- **Connect-after-auth.** The CollabClient ran on App mount, but
  the JWT wasn't written until OAuth completed. Effect: connect ->
  auth.error -> close, never reconnects. Fix: gate the useEffect on
  `authedUser` so the WS opens *after* sign-in.
- **Per-connection anon ids.** In anonymous mode every client used to
  share `sub="anon"`, so two anon users collided in the presence map
  and the second arrival overwrote the first. Fix: synthetic
  `anon_<uuid>` per connection.
- **Auth-timeout cleanup.** A 30s "must auth or close" timer was
  attached on every connection but never cleared on success/close --
  one orphan timer per disconnect. Fix: capture handle, clear in both
  paths.
- **Re-auth rejected.** A second `auth` message on an already-authed
  connection used to overwrite `conn.user`, orphaning the old presence
  entry until TTL gc reaped it. Fix: reject re-auth.

These were caught across five rounds of code review. The lesson on the
slide: **collab features look simple from the outside, but the
lifecycle around connect / auth / disconnect is where bugs hide.**

## Screenshots

### `Ollama.png`

Single user, guest auth (anon mode for the screenshot's compose
stack), agent loop driving Qwen 3 14B on the lab. The bottom right
shows `Qwen 3 14B (local)` and the chat shows a real exchange.

### `live-collab.png`

Two real GitHub-authenticated users (`AureliusNguyen` and `jhu04`),
both connected to the lab Hub via WebSocket. The bottom strip is the
money shot:

```
collab: connected (2 online: AureliusNguyen/solving in GodpherHack,
                              jhu04/solving in GodpherHack)
```

This is what the slide should anchor on -- two real handles, real
activity strings, both rendered live from the same Hub's PresenceStore
broadcast.

## Slide talking points

- OAuth design choice: Hub is the OAuth client, CLI owns only the
  loopback redirect. Means CLI never sees the GitHub access_token --
  only the Hub-issued JWT, which it can verify or revoke at will.
- Loopback-only redirect URI rejects attacker-controlled hosts. CSRF
  state token blocks cross-site request forgery on the OAuth dance.
- JWT verification on every authed request via `jose` + Zod. No
  unchecked casts; an invalid payload shape is a 401, not a runtime
  TypeError later.
- Hub refuses to start without explicit `ALLOW_ANONYMOUS_HUB=true`
  when auth env is missing. Fail-closed default removes the "forgot
  to set JWT_SECRET" failure mode.
- Collab uses the same JWT for the WebSocket handshake. One identity
  source covers HTTP + WS.
- The screenshot proves end to end: real GitHub sign-in, real handles
  on both sides, real-time presence updates.
