// Railway Infrastructure as Code. Erzeugt mit `railway config pull`, danach um
// den Frontend-Service ergaenzt.
//
// ACHTUNG: `railway config pull --force` UEBERSCHREIBT diese Datei mit dem
// Ist-Zustand und wirft dabei Kommentare und handgeschriebene Bloecke weg.
// Deshalb steht hier so wenig Prosa wie moeglich - das Warum zu jeder
// Entscheidung steht in README.md, Abschnitt "Deployment auf Railway".
// Vor einem `pull --force` committen, sonst ist der Stand weg.
//
//   railway config plan    # Diff ansehen - immer erst das
//   railway config apply
//
// `apply` deployt KEINEN Code, es setzt nur Konfiguration. Gebaut wird durch
// einen Push auf den Branch, den Railway am Service beobachtet.
//
// WARUM railway.json WEG MUSS: die Datei im Repo-Root wird beim BUILD gelesen,
// fuer jeden Service, der aus diesem Repo baut. Ihr `dockerfilePath: Dockerfile`
// hat gegen das `build` hier gewonnen - der Frontend-Service baute dadurch den
// Agenten und fiel im Health-Check mit 404 auf /api/healthz durch. Die
// deploy-Werte kamen dagegen aus dieser Datei. Solange railway.json existiert,
// ist also offen, welche Haelfte gilt.

import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

const REPO = "SwissTPH-IT/mastra-teamsbot";
const REGION = "europe-west4-drams3a";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: REGION });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: REGION, sizeMB: 50000 });
  const mastraTeamsbotVolume8j43 = volume("mastra-teamsbot-volume-8j43", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: REGION, sizeMB: 50000 });

  // Der Fachdaten-Dienst: Eigentuemer von app.*. Dasselbe Repo, unterschieden
  // allein durch dockerfilePath. Kein Volume - er haelt keine Dateien.
  const receiptApi = service("receipt-api", {
    source: github(REPO, { checkSuites: false }),
    build: { builder: "DOCKERFILE", dockerfilePath: "api/Dockerfile" },
    deploy: { healthcheckPath: "/healthz", healthcheckTimeout: 60, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    replicas: { [REGION]: 1 },
    env: {
      DATABASE_URL: Postgres.env.DATABASE_URL,
      DB_POOL_MAX: "5",
      // Das gemeinsame Geheimnis mit dem Agenten. preserve(): nie im Repo.
      API_SERVICE_TOKEN: preserve(),
      // Ohne diese zwei funktioniert nur der Service-Weg (Agent); Nutzertoken
      // werden mit 401 abgewiesen und der Grund landet im Log.
      ENTRA_TENANT_ID: preserve(),
      ENTRA_API_AUDIENCE: preserve(),
    },
  });

  // Build und Deploy stehen hier, weil railway.json geloescht wird. Ohne
  // `builder: DOCKERFILE` wuerde Railway den Builder wieder selbst raten.
  //
  // Diese Werte sind 1:1 die aus der alten railway.json - der `plan` zeigt sie
  // deshalb als "change" am Agenten, ohne dass sich am Verhalten etwas aendert.
  const mastraAgent = service("mastra-agent", {
    source: github(REPO, { checkSuites: false }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    // /healthz, NICHT /health: den Pfad belegt Mastra und antwortet
    // {"success":true} ohne DB-Pruefung. 180 s, damit die Migration beim ersten
    // Deploy nicht in den Health-Check laeuft.
    deploy: { healthcheckPath: "/healthz", healthcheckTimeout: 180, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    replicas: { [REGION]: 1 },
    volumeMounts: { "/app/data": mastraTeamsbotVolume8j43 },
    env: { DATABASE_URL: preserve(), MASTRA_MODEL: preserve(), MASTRA_TELEMETRY_DISABLED: preserve(), OPENROUTER_API_KEY: preserve(), TEAMS_APP_ID: preserve(), TEAMS_APP_PASSWORD: preserve(), TEAMS_APP_TENANT_ID: preserve(),
      // Fachdaten laufen ueber den API-Dienst. Literal mit Railways
      // ${{...}}-Syntax, weil hier ein Wert zusammengesetzt wird - ein
      // Referenz-Objekt liesse sich darin nicht interpolieren.
      API_URL: `http://\${{${receiptApi.name}.RAILWAY_PRIVATE_DOMAIN}}:4000`,
      API_SERVICE_TOKEN: preserve() },
  });

  // Die Weboberflaeche: dasselbe Repo, unterschieden allein durch
  // dockerfilePath. Kein Volume, keine Migration - und seit dem Umbau auf den
  // API-Dienst auch KEIN DATABASE_URL: sie hat keine Datenbankverbindung mehr.
  // Das ist der Grund, warum das Verbindungsbudget wieder Luft hat (Agent 8 +
  // API 5 statt zusaetzlich 3).
  const receiptFrontend = service("receipt-frontend", {
    source: github(REPO, { checkSuites: false }),
    build: { builder: "DOCKERFILE", dockerfilePath: "frontend/Dockerfile" },
    deploy: { healthcheckPath: "/api/healthz", healthcheckTimeout: 60, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    replicas: { [REGION]: 1 },
    env: {
      // Alle Belegdaten kommen ueber den Dienst. Literal mit Railways
      // ${{...}}-Syntax, weil hier ein Wert zusammengesetzt wird - ein
      // Referenz-Objekt liesse sich darin nicht interpolieren (es wuerde zu
      // "[object Object]").
      API_URL: `http://\${{${receiptApi.name}.RAILWAY_PRIVATE_DOMAIN}}:4000`,
      // Dasselbe Geheimnis wie beim Dienst und beim Agenten. preserve(): nie
      // im Repo. Damit darf dieser Service im Namen jedes Nutzers lesen -
      // welcher es ist, bestimmt die oid aus der Session (X-Subject-Aad).
      API_SERVICE_TOKEN: preserve(),
      // Nur fuer die Belegbilder, die als Dateien am Volume des Agenten liegen.
      MASTRA_URL: `http://\${{${mastraAgent.name}.RAILWAY_PRIVATE_DOMAIN}}:4111`,
      // Anmeldung ueber Entra. AUTH_URL muss die oeffentliche URL sein: hinter
      // Railways Proxy baut Auth.js die Redirect-URI sonst aus dem internen
      // Host, und der Rueckweg von Microsoft landet im Leeren.
      AUTH_SECRET: preserve(),
      AUTH_URL: preserve(),
      AUTH_MICROSOFT_ENTRA_ID_ID: preserve(),
      AUTH_MICROSOFT_ENTRA_ID_SECRET: preserve(),
      AUTH_MICROSOFT_ENTRA_ID_ISSUER: preserve(),
    },
  });

  return project("agent-framework", {
    resources: [mastraAgent, receiptApi, receiptFrontend, Postgres, postgresVolume, mastraTeamsbotVolume8j43],
  });
});
