# Assignment Notebook (asigment.yakton.net)

Cloudflare Worker + static site. Admin creates student accounts; students track classes and homework with urgency ratings.

## Setup
1. Push this repo to GitHub, then Cloudflare > Workers & Pages > Create > Import a repository.
2. Worker Settings > Variables and Secrets > add a **Secret** named `ADMIN_PASSWORD` (your admin password).
3. Deploy. The `DB` KV namespace is auto-created. If your deploy errors about it, create a KV namespace manually and add `id = "..."` under `[[kv_namespaces]]` in wrangler.toml.
4. Open asigment.yakton.net > Admin tab > enter ADMIN_PASSWORD > create student accounts.
