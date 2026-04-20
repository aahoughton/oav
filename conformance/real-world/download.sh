#!/usr/bin/env bash
# Fetches the real-world OpenAPI 3.x spec corpus into ./specs/.
# Re-run to refresh. Specs are gitignored.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p specs
cd specs
curl -sSL -o adyen-checkout.json https://api.apis.guru/v2/specs/adyen.com/CheckoutService/70/openapi.json &
curl -sSL -o asana.yaml          https://raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml &
curl -sSL -o box.json            https://raw.githubusercontent.com/box/box-openapi/main/openapi.json &
curl -sSL -o digitalocean.yaml   https://api.apis.guru/v2/specs/digitalocean.com/2.0/openapi.yaml &
curl -sSL -o github.json         https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json &
curl -sSL -o stripe.json         https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json &
curl -sSL -o twilio.json         https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json &
wait
ls -lh
