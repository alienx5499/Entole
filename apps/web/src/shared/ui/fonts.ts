import { Caveat_Brush, IBM_Plex_Mono, Kalam } from "next/font/google";

const heading = Caveat_Brush({ weight: "400", subsets: ["latin"], variable: "--font-heading" });
const body = Kalam({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ weight: ["400", "600"], subsets: ["latin"], variable: "--font-mono" });

export const fontClassNames = `${heading.variable} ${body.variable} ${mono.variable}`;
