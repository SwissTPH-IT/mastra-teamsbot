import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone-Output fuer das Container-Image: Next kopiert dabei die
  // tatsaechlich benutzten node_modules mit. Ohne das muesste das Image das
  // gehoistete node_modules des ganzen Workspace mitschleppen, inklusive der
  // Mastra-Abhaengigkeiten des Agenten.
  output: "standalone",
  // Der Workspace-Root, nicht das Frontend-Verzeichnis: npm hoistet die
  // Abhaengigkeiten dorthin, und ohne diese Angabe findet das File-Tracing sie
  // nicht.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};

export default nextConfig;
