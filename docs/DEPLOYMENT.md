# Hosted API

- API information: https://commerceflow-api-4i9p.onrender.com/
- Health: https://commerceflow-api-4i9p.onrender.com/health
- Ticket processing: `POST https://commerceflow-api-4i9p.onrender.com/triage`
- Source: https://github.com/Saurav-Kiron/commerceflow-n8n
- Render service: `commerceflow-api`, Singapore, free plan.
- Processing mode: `rules` (no paid LLM calls).

The current service was created through the Render CLI with configuration equivalent to `render.yaml`. The API key was generated locally and supplied privately to Render; it is not in the repository. A private local copy is in `.env.hosted` in the original workspace, excluded by `.gitignore`.

## Send a synthetic ticket

From the original workspace in PowerShell:

```powershell
$hostedKey = (Get-Content .env.hosted | Where-Object { $_ -like 'TRIAGE_API_KEY=*' }) -replace '^TRIAGE_API_KEY=', ''
Invoke-RestMethod -Method Post -Uri https://commerceflow-api-4i9p.onrender.com/triage `
  -Headers @{ 'x-api-key' = $hostedKey } -ContentType application/json `
  -Body (Get-Content examples/shipping.json -Raw)
```

Do not share `.env.hosted`, paste its value into a public issue or commit it. The owner can manage the configured secret in Render's environment settings.

## Connect n8n

Import `workflows/commerceflow.json`. Set **Triage API** URL to `https://commerceflow-api-4i9p.onrender.com/triage`. Select a Header Auth credential with name `x-api-key` and the private hosted API key. Configure a separate credential for the incoming **Ticket Webhook**. The exported workflow deliberately contains no credentials.

The n8n instance itself is not hosted by this API deployment. Run the supplied local Compose setup or use your own n8n installation. The 45-second HTTP timeout can be too short during a free-service cold start: open `/health`, wait for the service to wake, then retry the ticket request.

## Limits and updates

Render free services sleep after inactivity, and their local files are ephemeral. SQLite ticket history and duplicate protection reset after storage loss. This portfolio deployment is for synthetic tickets, not a durable support system. No paid resources or OpenAI calls are enabled.

This service uses a public Git repository URL. Do not assume pushes trigger a deploy. After application-code changes, trigger a manual deploy from Render and verify `/health` and `/triage` again. `render.yaml` can provision an equivalent service through a Blueprint, but the existing CLI-created service is not managed by a Blueprint.
