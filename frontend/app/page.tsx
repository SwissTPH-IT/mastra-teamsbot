import { redirect } from "next/navigation";

// Die Oberflaeche hat genau eine Ansicht. Kein Dashboard davor.
export default function Home() {
  redirect("/belege");
}
