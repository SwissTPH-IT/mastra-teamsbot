import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Das Drizzle-Schema kommt als Workspace-Abhaengigkeit herein
  // (mastra-teamsbot/db/schema -> ../src/db/schema.ts) und ist rohes
  // TypeScript, kein gebautes Paket. transpilePackages ist der dafuer
  // vorgesehene Weg.
  //
  // Die naheliegende Alternative waere ein Pfad-Alias auf ../src/db plus
  // experimental.externalDir. Das ist seit Next 15 defekt und offen
  // (vercel/next.js#81177) - deshalb der Workspace.
  transpilePackages: ["mastra-teamsbot"],

  // Standalone-Output fuer das Container-Image: Next kopiert dabei die
  // tatsaechlich benutzten node_modules mit. Ohne das muesste das Image das
  // gehoistete node_modules des ganzen Workspace mitschleppen, inklusive der
  // Mastra-Abhaengigkeiten des Agenten.
  output: "standalone",
  // Der Workspace-Root, nicht das Frontend-Verzeichnis: sonst findet das
  // File-Tracing die gehoisteten Pakete und src/db nicht.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};

export default nextConfig;
