#!/bin/sh
# Ein Image, zwei Rollen - umgeschaltet ueber RUN_MODE.
#
# Warum eine Umgebungsvariable und kein eigener Start-Befehl pro Service:
# auf Railway wurden in diesem Projekt sowohl preDeployCommand als auch
# startCommand aus der railway.json stillschweigend nicht angewandt. Variablen
# kommen dagegen nachweislich an (der Agent liest DATABASE_URL daraus). Also
# entscheidet eine Variable, nicht die Plattform-Config.
#
#   RUN_MODE nicht gesetzt / "server"  Migration, dann Agent (Default)
#   RUN_MODE=prune                     Retention anwenden, dann beenden
#   RUN_MODE=migrate                   nur migrieren, dann beenden
#
# set -e: bricht ab, sobald ein Schritt fehlschlaegt. Im server-Modus startet
# der Agent dadurch nur, wenn die Migration mit Exit-Code 0 durchlief.
set -e

OUT=/app/.mastra/output

case "${RUN_MODE:-server}" in
  server)
    node "$OUT/scripts/migrate.mjs"
    # exec: node ersetzt die Shell und bekommt SIGTERM direkt, sonst haengt
    # der Container beim Redeploy bis zum Kill-Timeout.
    exec node "$OUT/index.mjs"
    ;;
  prune)
    exec node "$OUT/scripts/prune.mjs"
    ;;
  migrate)
    exec node "$OUT/scripts/migrate.mjs"
    ;;
  *)
    echo "Unbekannter RUN_MODE=\"$RUN_MODE\". Erlaubt: server, prune, migrate." >&2
    exit 1
    ;;
esac
