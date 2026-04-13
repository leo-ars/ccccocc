# Cloudflare Access Setup

This runbook is for this repo's production deployment on a Cloudflare Worker with a Worker custom domain such as `app.example.com`.

It assumes "custom hostname" means a Worker custom domain, not Cloudflare for SaaS custom hostnames. If you mean Cloudflare for SaaS, the Access application flow is slightly different and you should use the Access app's `Custom` hostname input mode instead.

## What this repo expects

- Non-local hostnames are rejected unless both `CF_ACCESS_AUD` and `CF_ACCESS_TEAM` are configured in the Worker environment.
- The Worker expects Cloudflare Access to inject a `Cf-Access-Jwt-Assertion` header and validates it on every authenticated request.
- `CF_ACCESS_TEAM` in this repo is the team name only, for example `myteam`, not the full URL. The code builds `https://<team>.cloudflareaccess.com` internally.

Relevant code:

- [src/worker/auth.ts](/home/vendetta/code/ccccocc/src/worker/auth.ts:53)
- [src/worker/auth.ts](/home/vendetta/code/ccccocc/src/worker/auth.ts:89)
- [.dev.vars.example](/home/vendetta/code/ccccocc/.dev.vars.example:1)

## Production setup

### 1. Pick the production hostname

Choose the hostname that will front the Worker, for example:

- `app.example.com`

That hostname must live in a Cloudflare-managed zone.

### 2. Attach the Worker to the custom domain

Add a custom domain route to [wrangler.jsonc](/home/vendetta/code/ccccocc/wrangler.jsonc:1).

Example:

```jsonc
{
  "routes": [
    {
      "pattern": "app.example.com",
      "custom_domain": true,
    },
  ],
}
```

Cloudflare's current Workers docs recommend `custom_domain: true` on a `routes` entry for Worker custom domains.

For this repo's production deployment, you do not need Cloudflare Tunnel. The Worker runs on Cloudflare's edge and the custom domain points directly at the Worker.

### 3. Create the Access application

In Cloudflare One:

1. Go to `Access controls` > `Applications`.
2. Select `Add an application`.
3. Select `Self-hosted`.
4. Name the app.
5. Add a public hostname matching the Worker custom domain, for example `app.example.com`.
6. Add at least one `Allow` policy for the people who should use the app.
7. Save the application.

Create the Access application before or at the same time as the public hostname goes live. Otherwise the custom domain may be reachable without Access until the Access app exists.

### 4. Copy the Access AUD tag

In Cloudflare One:

1. Open the Access application.
2. Go to `Basic information`.
3. Copy `Application Audience (AUD) Tag`.

That value becomes `CF_ACCESS_AUD`.

### 5. Find your Zero Trust team name

In Cloudflare One:

1. Go to `Settings`.
2. Find your team domain, which looks like `myteam.cloudflareaccess.com`.
3. Use only the `myteam` portion for this repo's `CF_ACCESS_TEAM` value.

Do not store `https://myteam.cloudflareaccess.com` in `CF_ACCESS_TEAM` for this project. The Worker code expects only the team slug.

### 6. Set Worker secrets

Run:

```bash
wrangler secret put CF_ACCESS_AUD
wrangler secret put CF_ACCESS_TEAM
```

When prompted:

- `CF_ACCESS_AUD`: paste the Access application AUD tag
- `CF_ACCESS_TEAM`: enter the team name only, for example `myteam`

### 7. Deploy

Run:

```bash
npm run deploy
```

This repo's deploy command builds the frontend and runs `wrangler deploy`.

### 8. Verify

Check the following:

1. Visiting `https://app.example.com` redirects to Cloudflare Access login.
2. After login, the SPA loads normally.
3. Terminal WebSocket connections under `/ws/terminal` succeed after login.
4. A request that bypasses Access does not work because the Worker requires a valid `Cf-Access-Jwt-Assertion` header.

## Important repo-specific gotchas

### Health checks

The Worker itself allows `/api/health` without app-level auth:

- [src/worker/index.ts](/home/vendetta/code/ccccocc/src/worker/index.ts:18)

But if Access protects the whole hostname, Access will still block unauthenticated requests before they reach the Worker.

If you need unauthenticated health checks in production, use one of these patterns:

- Preferred: a separate public hostname for health or status traffic
- Alternative: a more specific Access application or policy for `/api/health` with a `Bypass` rule
- Alternative for automation: use an Access service token instead of making the endpoint public

### Account-level default deny

After the app is working, consider enabling Cloudflare's `Require Cloudflare Access Protection` setting at the account level. That prevents future hostnames from being exposed without an Access application.

Be careful: it blocks any hostname in the account that does not already have an Access application or explicit exemption.

### Service tokens for CI, probes, or automation

If uptime checks, CI jobs, or other machines need access, create a Cloudflare Access service token and use a `Service Auth` policy.

Initial request headers look like:

```http
CF-Access-Client-Id: <CLIENT_ID>
CF-Access-Client-Secret: <CLIENT_SECRET>
```

## Local dev testing with Access

If you want to test the full Access flow before production:

1. Create a second Access application on a dev hostname such as `dev-app.example.com`.
2. Create `.dev.vars` from [.dev.vars.example](/home/vendetta/code/ccccocc/.dev.vars.example:1).
3. Put the dev app's AUD tag into `CF_ACCESS_AUD`.
4. Put your team name slug into `CF_ACCESS_TEAM`.
5. Start the app with `npm run dev`.
6. Expose the local dev server through `cloudflared` on the same Access-protected dev hostname.

This repo treats `localhost` as open dev mode, so you only need the tunnel when you want to test the real Access login and JWT flow end to end.

## Official docs

- Cloudflare Access self-hosted apps: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- Validate Access JWTs: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Application paths and path precedence: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Service tokens: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- Require Access protection: https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/require-access-protection/
- Workers custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Zero Trust team domain FAQ: https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/
