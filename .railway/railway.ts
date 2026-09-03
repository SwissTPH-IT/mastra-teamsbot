// Railway Infrastructure as Code – die Deployment-Definition dieses Projekts.
//
// Ersetzt Config as Code (railway.json / railway.prune.json). Railway hat das
// deprecated: bestehende Dateien laufen noch bis 2026-12-01, aber seit
// 2026-08-28 kann ein Service, der Config as Code noch nie benutzt hat, es
// nicht mehr aktivieren. Der Frontend-Service ist neu – für ihn gäbe es diesen
// Weg also gar nicht mehr, das Feld "Config File" in den Service-Settings
// bliebe wirkungslos.
//
// Angewandt wird diese Datei NICHT beim Deploy, sondern über die CLI – im
// Repo-Root, weil die CLI sie hier und in den Elternverzeichnissen sucht:
//
//   railway login && railway link              # Projekt + Environment wählen
//   railway config plan                        # Diff ansehen – IMMER erst das
//   railway config apply                       # ... dann anwenden
//
// Die IaC-Engine steckt in der CLI, nicht im npm-Paket `railway`, und verlangt
// CLI >= 5.42.1. Eine ältere CLI hat kein `config`-Subcommand. Das npm-Paket in
// den devDependencies liefert nur die Typen, damit `npm run typecheck` diese
// Datei prüft.
//
// `apply` deployt KEINEN Code: es legt Services an und setzt ihre Konfiguration.
// Der Code kommt aus GitHub (source: github(...)), gebaut wird also durch einen
// Push auf den Branch.
//
// Pro Environment einmal: `railway link` wählt staging oder production, und
// `apply` schreibt genau dorthin. Die Datei ist für beide dieselbe.
//
// WICHTIG beim ersten Mal: `railway config pull --force` zuerst laufen lassen
// und die Namen unten mit den real existierenden Services abgleichen. Ein
// abweichender Name ist für Railway ein anderer Service – der Plan würde einen
// neuen anlegen und den alten zum Löschen vorschlagen. Der `plan`-Output sagt
// genau das, bevor etwas passiert.
//
// ZU DEN VARIABLEN: hier steht ABSICHTLICH jede Variable, die an einem Service
// existiert – auch die, deren Wert wir nicht kennen. Ob ein `apply` Variablen
// entfernt, die in dieser Datei fehlen, ist aus der Doku nicht belegt, und ein
// verschwundenes TEAMS_APP_PASSWORD wäre teuer. `preserve()` heisst "Wert nicht
// anfassen": der im Dashboard gesetzte Wert bleibt, und er taucht auch im
// `plan`-Output nicht auf. Literale stehen nur dort, wo der Wert aus der
// Architektur folgt und nicht aus einer Betriebsentscheidung. Was `apply`
// wirklich täte, sagt `plan` – vorher nichts anwenden.

import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
  volume,
} from 'railway/iac';

const REPO = 'Wenzel-Tomek/mastra-teamsbot';
const BRANCH = 'main';

/**
 * Interne Adresse eines Service als Literal in Railways eigener
 * Referenz-Syntax.
 *
 * Nötig, weil hier ein Wert zusammengesetzt wird (Schema + Domain + Port):
 * `svc.env.RAILWAY_PRIVATE_DOMAIN` ist ein Referenzobjekt und lässt sich nicht
 * in einen String interpolieren – das ergäbe "[object Object]". Ein Literal mit
 * ${{...}} löst Railway zur Deploy-Zeit auf, genau wie einen im Dashboard
 * getippten Wert. Der Servicename kommt aus dem Objekt, damit eine Umbenennung
 * die Adresse mitzieht.
 */
function privateUrl(svc: { name: string }, port: number): string {
  return `http://\${{${svc.name}.RAILWAY_PRIVATE_DOMAIN}}:${port}`;
}

export default defineRailway(() => {
  // ─── Datenbank ─────────────────────────────────────────────────────────────
  // Eine Instanz pro Environment, zwei Schemas: "mastra" (von PostgresStore
  // verwaltet) und "app" (unsere Fachdaten). Backups gehören eingeschaltet –
  // das ist eine Einstellung am Service, keine IaC-Option.
  const db = postgres('Postgres');

  // ─── Volume für die Belegbilder ────────────────────────────────────────────
  // Die Originaldateien liegen im Dateisystem, nicht in Postgres
  // (app.receipts.file_reference hält nur "local:uploads/<uploadId>"). Ohne
  // dieses Volume sind sie nach jedem Redeploy weg.
  const uploads = volume('receipt-uploads');

  // ─── Agent ─────────────────────────────────────────────────────────────────
  // Kein startCommand: das Image entscheidet über seinen ENTRYPOINT
  // (scripts/docker-entrypoint.sh) anhand von RUN_MODE. Genau deshalb – auf
  // Railway wurden in diesem Projekt sowohl preDeployCommand als auch
  // startCommand stillschweigend nicht angewandt, Variablen kamen dagegen
  // nachweislich an. Default (RUN_MODE ungesetzt) ist: migrieren, dann Server.
  const agent = service('mastra-agent', {
    source: github(REPO, { branch: BRANCH }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    deploy: {
      // /healthz, NICHT /health: der Pfad ist von Mastra belegt und liefert
      // {"success":true} ohne jede DB-Prüfung.
      healthcheckPath: '/healthz',
      // 180 s, damit die Migration beim allerersten Deploy (43 Tabellen plus
      // Indizes) nicht in den Health-Check läuft.
      healthcheckTimeout: 180,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
    },
    volumeMounts: { '/app/data': uploads },
    env: {
      // Echte Referenz, kein kopierter Connection String: Railway rotiert das
      // Passwort beim Neuaufbau des Datenbank-Service.
      DATABASE_URL: db.env.DATABASE_URL,
      // 0.0.0.0 ist zwingend, sonst bekommt Railways Proxy keine Verbindung.
      // Folgt aus der Architektur, deshalb als Literal.
      MASTRA_HOST: '0.0.0.0',
      // Betriebsentscheidungen und Secrets: Wert bleibt im Dashboard. Das Modell
      // MUSS vision-fähig sein (Belege sind Bilder) – die Form steht in
      // .env.example, der aktive Wert gehört nicht ins Repo überschrieben.
      MASTRA_MODEL: preserve(),
      MASTRA_TELEMETRY_DISABLED: preserve(),
      OPENROUTER_API_KEY: preserve(),
      TEAMS_APP_ID: preserve(),
      TEAMS_APP_PASSWORD: preserve(),
      TEAMS_APP_TENANT_ID: preserve(),
      // Nur relevant, wenn ein Browser Mastra direkt aufruft – im Normalbetrieb
      // ohne Funktion. Steht hier, damit ein apply sie nicht entfernt.
      FRONTEND_ORIGIN: preserve(),
    },
  });

  // ─── Weboberfläche ─────────────────────────────────────────────────────────
  // Zweiter Service aus demselben Repo, unterschieden allein durch
  // dockerfilePath. Unter Config as Code brauchte das eine zweite Config-Datei
  // plus einen Eintrag in den Service-Settings; hier steht es einfach da.
  const frontend = service('receipt-frontend', {
    source: github(REPO, { branch: BRANCH }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'frontend/Dockerfile' },
    deploy: {
      // Prüft die Datenbankverbindung mit. Unter app/api/, weil in Next alles
      // Serverseitige dort liegt.
      healthcheckPath: '/api/healthz',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
    },
    env: {
      // Dieselbe Instanz wie der Agent, eigener kleiner Pool. Das Frontend
      // migriert nichts.
      DATABASE_URL: db.env.DATABASE_URL,
      // Nur für die Belegbilder, über Private Networking.
      MASTRA_URL: privateUrl(agent, 4111),
      // Klein halten: eine kleine Railway-Instanz erlaubt rund 20 Verbindungen
      // insgesamt, und der Agent nimmt schon 8.
      FRONTEND_DB_POOL_MAX: '3',
    },
    // networking bleibt bewusst unangetastet, damit ein im Dashboard
    // generiertes *.up.railway.app nicht wegkonfiguriert wird. Zur Konsequenz –
    // die Oberfläche ist unauthentifiziert – siehe frontend/README.md.
  });

  // ─── Prune (Cron) ──────────────────────────────────────────────────────────
  // Dasselbe Image wie der Agent, andere Rolle über RUN_MODE. Kein
  // healthcheckPath (der Job hört auf keinem Port) und restartPolicy NEVER –
  // ein Cron-Job soll terminieren, nicht neu starten.
  const prune = service('mastra-prune', {
    source: github(REPO, { branch: BRANCH }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    deploy: {
      cronSchedule: '0 3 * * *', // Railways Minimum ist 5 Minuten, Zeitzone UTC
      restartPolicyType: 'NEVER',
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      // Wählt die zweite Rolle desselben Images. Folgt aus der Architektur.
      RUN_MODE: 'prune',
      // Die Policies selbst stehen in scripts/prune.mjs – eine Definition, nicht
      // zwei. Diese drei sind nur Überschreibungen; ihr Wert bleibt im Dashboard.
      RETENTION_SPANS: preserve(),
      RETENTION_SNAPSHOTS: preserve(),
      RETENTION_MESSAGES: preserve(),
    },
  });

  // Staging und Production teilen diese Definition; unterschieden werden sie
  // durch das per `railway link` gewählte Environment, und jedes hat seine
  // eigene Datenbank. Entsteht später ein echter Unterschied (kürzere Retention
  // auf staging, ein anderes Modell), kommt hier ein `ctx`-Parameter dazu und
  // `ctx.isEnvironment('production')` entscheidet – im Repo, nicht im Dashboard.
  return project('belegerfassung', {
    resources: [db, uploads, agent, frontend, prune],
  });
});
