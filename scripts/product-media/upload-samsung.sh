#!/usr/bin/env bash
# Upload the 12 Samsung unit photos to the public product-media bucket under samsung/. NOT RUN YET (go-live step 1).
# Needs SUPABASE_URL and a service-role key in SUPABASE_SERVICE_ROLE_KEY (Lovable > Cloud > secrets); never commit the key.
set -euo pipefail
: "${SUPABASE_URL:?}"; : "${SUPABASE_SERVICE_ROLE_KEY:?}"
cd "$(dirname "$0")/samsung"
for f in *.png; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/storage/v1/object/product-media/samsung/$f" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "x-upsert: true" -H "Content-Type: image/png" -H "Cache-Control: max-age=31536000" --data-binary "@$f")
  echo "$f $code"; [ "$code" = 200 ] || exit 1
done
echo "Check: curl -I $SUPABASE_URL/storage/v1/object/public/product-media/samsung/ac100nn4deh-af.png"
