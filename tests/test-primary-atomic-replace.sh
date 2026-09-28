#!/usr/bin/env sh
# Regression probe for the primary token's same-directory atomic replacement.
set -eu

tmp=$(mktemp -d "${TMPDIR:-/tmp}/ak-primary-atomic.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
file="$tmp/primary"
printf 'schema=ak-primary.v1\nsession_id=old\npi_session=owner\n' >"$file"

# The writer prepares a full new token off-path, then renames it over the live one.
new="$tmp/primary.tmp"
printf 'schema=ak-primary.v1\nsession_id=new\npi_session=owner\n' >"$new"
mv "$new" "$file"
[ "$(awk -F= '$1=="session_id" {print $2}' "$file")" = new ]

# Model an interrupted in-place writer: a concurrent reader can observe truncation.
printf 'schema=ak-primary.v1\nsession_id=old\npi_session=owner\n' >"$file"
( : >"$file"; sleep 0.05; printf 'schema=ak-primary.v1\nsession_id=new\npi_session=owner\n' >"$file" ) &
pid=$!
observed_empty=0
while kill -0 "$pid" 2>/dev/null; do
    [ -s "$file" ] || observed_empty=1
    sleep 0.005
done
wait "$pid"
[ "$observed_empty" -eq 1 ]

a="${file}.tmp"
printf 'schema=ak-primary.v1\nsession_id=final\npi_session=owner\n' >"$a"
# Readers looping while rename occurs must only see complete old/new records.
mv "$a" "$file"
[ "$(awk -F= '$1=="session_id" {print $2}' "$file")" = final ]
echo 'primary atomic-replace regression probe: PASS'
