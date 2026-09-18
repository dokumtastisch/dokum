# DESIGN.md — das Design von Dokum

**Diese Datei beschreibt das Design, wie es sein soll.** Referenz ist der Stand von Commit `0e9b1cd` — die Gestaltung, die Lucas gebaut hat.

Wer eine Funktion baut, hält sich daran. Wer das Design ändern will, ändert **zuerst diese Datei**, bewusst und für sich.

---

## Die eine Regel

> **Style wird nie nebenbei geändert.**
>
> Nicht Abstände, nicht Farben, nicht Größen, nicht Schriftgewichte, nicht Radien, nicht Hover- oder Fokus-Zustände. Auch dann nicht, wenn das Markup aus funktionalen Gründen wechseln muss.

Wenn ein `<p>` zu einem `<Link>` wird oder ein `<div>` zu einer `<section>`: **die alten Klassen wortgleich mitnehmen.** Ein Link, der eine Überschrift ersetzt, sieht aus wie die Überschrift — er ist ein Link, damit die Zeile per Tastatur erreichbar ist, nicht damit sie wie ein Link aussieht.

Einzige Ausnahme, minimal gehalten: die Zugänglichkeit, die das neue Verhalten wirklich braucht — ein Fokusring an einem neuen Bedienelement, `cursor-pointer` an einer neu klickbaren Zeile.

**Nichts angleichen, was unterschiedlich aussieht.** Der Unterschied kann Absicht sein.

Ist eine Aufgabe ohne gestalterische Entscheidung nicht lösbar: **fragen.**

---

## ⚠ Keine Design-Bibliothek installieren

Das ist schon einmal schiefgegangen und war von außen kaum zu sehen: eine Sitzung hat `shadcn` installiert, und dessen `tailwind.css` plus sein `:root`-Block haben `globals.css` überschrieben — inklusive `--foreground`, das der `body` liest. Damit hatte eine Komponentenbibliothek die Gestaltung der **ganzen App** übernommen, ohne dass irgendwo eine Designentscheidung getroffen worden wäre.

Konkret verboten, ohne vorher zu fragen:

- `@import` einer fremden Stylesheet-Bibliothek in `globals.css`
- Tokens in `:root` anlegen oder ändern, die der `body` oder gemeinsame Elemente lesen
- Utility-Pakete wie `tw-animate-css`, die neue Klassen global bereitstellen

**Verhalten einkaufen ist erlaubt, Aussehen nicht.** Aktuell nur `@dnd-kit` (Ziehen) und `lucide-react` (Symbole). `shadcn`, `radix-ui`, `class-variance-authority` und `tw-animate-css` sind wieder draußen, und `src/components/ui/` gibt es nicht mehr — es gibt keine Komponentenbibliothek in diesem Projekt.

**Stille Ausfälle:** Klassen aus einem entfernten Plugin (`data-open:`, `animate-in`, `bg-popover`) werfen keinen Fehler. Tailwind erzeugt sie einfach nicht, und die Komponente steht ungestylt da, während Build, Lint und Tests grün bleiben. Deshalb nur Klassen benutzen, die Tailwind von sich aus kennt — Zustände als `data-[state=open]:`, nicht als `data-open:`.

---

## Farben

Alles kommt aus `globals.css`. Es gibt kein zweites Farbsystem.

| Token / Wert | Klasse | Wofür |
|---|---|---|
| `#db3627` | `brand` | Akzent, aktive Zeilen, Hauptaktionen, Preis-Badges |
| `#a6281c` | `brand-dark` | dunklere Variante |
| `#ffffff` | `--background` | Body |
| `#171717` | `--foreground` | Body-Text |
| `#fffdf8` | `bg-[#fffdf8]` | Papier: Inhaltsflächen, Navbar (95 % + Blur) |
| `#faf8f3` | `bg-[#faf8f3]` | Sidebar, minimal wärmer als das Papier |
| `#f4f5fa` | `bg-[#f4f5fa]` | Merkformel-Kasten der Lernseite |
| `#efeeec` | `bg-[#efeeec]` | Beispiel-Kasten der Lernseite |

**Graustufen kommen direkt von Tailwind** — `text-gray-400`, `text-gray-500`, `text-gray-700`, `border-gray-100`, `border-gray-200`, `bg-gray-50`. Keine semantischen Alias-Tokens (`muted-foreground`, `border`, `popover`); die gab es nur, solange shadcn installiert war.

**Zustandsfarben:** veröffentlicht/erfolgreich `emerald` (`bg-emerald-50 text-emerald-700`), Warnung `amber`, Fehler und Löschen `red`. Ein Löschknopf ist grau und wird erst beim Hover rot — der Knopf selbst bleibt sichtbar, nur seine Farbe hält sich zurück.

`.btn-brand` in `globals.css` liefert den Fokus-/Hover-Schein der Markenknöpfe. Fläche und Farbe stehen als Klassen daneben.

---

## Maße, die überall gelten

| Was | Wert | Quelle |
|---|---|---|
| Navbar-Höhe | **66 px**, `sticky top-0 z-50` | `Navbar.tsx` |
| Logo-Position | **20 px von links, 16 px von oben — auf jeder Seite** | `Navbar.tsx`, Katalog-Sidebar |
| Sidebar darunter | `lg:sticky lg:top-[66px] lg:h-[calc(100svh-66px)]` | Kurs-Shell |
| Sidebarbreite | `lg:w-72` (Student) · `lg:w-80` (Admin) | |
| Sprungziel-Versatz | `ANCHOR_SCROLL_OFFSET = 112` | `lib/document-anchor.ts` |

**Die 66 stehen an mehreren Stellen und müssen zusammenpassen.** Wer die Navbar-Höhe ändert, sucht `66px` im ganzen `src/`.

**Das Logo steht überall auf demselben Pixel.** Die Navbar ist deshalb **randbündig** (`px-5`, kein zentrierter `max-w`-Container) und ihr Innenabstand wächst nicht mit dem Breakpoint. Seiten, die die Navbar ausblenden und ein eigenes Logo tragen — heute der Katalog — setzen es auf dieselben 20/16 px (`aside px-4 py-4` + `px-1` am Link). Der **Footer** behält seinen zentrierten `max-w-[1420px]`-Deckel: er schließt die Seite ab, statt sie anzuführen.

**Radien:** `rounded-md` für Bedienelemente und Eingaben, `rounded-xl` für Karten und Panels, `rounded-full` für Badges und Punkte.

### Seitengerüst („full bleed")

`<main>` gibt jeder Seite `px-4 sm:px-8`. Ein Gerüst über die volle Breite hebt das auf: `-mx-4 bg-[#fffdf8] sm:-mx-8`.

Die Trennlinie zur Navbar ist in den Kurs-Gerüsten eine **sticky** 1px-Zeile (`sticky top-[66px] z-40 h-px bg-gray-200`) — ein `border-t` wandert beim Scrollen mit und lässt die Navbar ohne Kante zurück. Auf Seiten ohne sticky Sidebar steht sie als `border-t border-gray-200`.

---

## Typografie

Schrift: **Arial/Helvetica** (`globals.css`). Geist ist als Variable geladen, aber der Body benutzt Arial.

| Rolle | Klassen |
|---|---|
| Seitentitel | `text-4xl font-black tracking-[0]` bzw. `tracking-[-0.01em]` |
| Abschnitt (H2) | `text-2xl`/`text-3xl font-black` |
| Admin-Seitentitel | `text-2xl font-bold text-gray-900` |
| Fließtext Lernseite | `text-[17px] leading-[1.75] text-gray-900` |
| UI-Text | `text-sm`, Zwischentöne `text-[13px]`, `text-xs` |
| **Mikro-Label** | `text-[10px]`/`text-[11px] font-bold tracking-[0.1em] uppercase text-gray-400` |

Das Mikro-Label ist das wiederkehrendste Muster der App: „EINHEITEN", „KURSNAME", „Blöcke", die Beschriftung der Beispiel-Box. Wer eine Abschnittsüberschrift in einer Sidebar oder einem Panel braucht, nimmt genau dieses.

Gewichte nach Häufigkeit: `font-semibold` (UI-Standard) → `font-medium` (ruhiger) → `font-bold` → `font-black` (nur Titel).

Zahlen in Tabellen und Bäumen: `tabular-nums`.

---

## Bausteine

**Es gibt keine Button-Komponente.** Klassen stehen direkt am Element, so wie im ganzen committeten Code. Die drei Formen, die es gibt:

| Form | Klassen |
|---|---|
| Hauptaktion | `rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 btn-brand` |
| Neutral | `rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50` |
| Markiert sekundär | `rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 btn-brand` |

**Kleine Zeilenaktion** (löschen, bearbeiten): `flex h-6 w-6 items-center justify-center rounded-md text-gray-400 [&_svg]:size-3.5`, dazu `hover:bg-red-50 hover:text-red-600` beim Löschen bzw. `hover:bg-gray-100 hover:text-gray-700` sonst.

⚠ **Diese Knöpfe sind immer sichtbar**, nicht erst bei Hover. Ein Löschknopf, der erst beim Darüberfahren erscheint, wirkt schlicht abwesend — das war ein Fehlversuch und ist zurückgenommen. Nur der Ziehgriff blendet sich ein, weil er Verzierung an einer Zeile ist, die ohnehin klickbar ist.

**Statuspille:** `inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600`.

**Schalter:** eine Checkbox (`h-4 w-4 rounded border-gray-300 accent-brand`), wie „Publish immediately" im Kursformular. Die App hatte nie einen Toggle-Switch.

**Popover / Menü:** `src/components/lessons/PopoverMenu.tsx` — Öffnen, Escape, Klick daneben, Fokus zurück. Panel: `rounded-xl border border-gray-200 bg-white p-1.5 shadow-[0_8px_20px_rgb(0_0_0_/_0.08)]`.

**Baumzeile** (beide Sidebars): Punkt links, Text mittig mit `truncate`, optionales Badge rechts.
Aktiv `bg-brand/10 text-brand`, inaktiv `text-gray-700 hover:bg-black/[0.04]`.
Der Punkt ist `h-1.5 w-1.5 rounded-full` — gefüllt, wenn erreichbar, `border`-Ring, wenn gesperrt.

**Ziehgriffe** blenden sich bei Hover ein (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100` am Kind, `group` am Container). Löschen und Bearbeiten NICHT — siehe oben.

**Karten, Panels, Tabellen:** `rounded-xl border border-gray-200 bg-white`, Tabellen dieselbe Hülle mit `overflow-x-auto`.

**Eingaben:** `rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none`.

**Symbole:** `lucide-react`, in Buttons ohne eigene Größenklasse (der Button setzt `size-4`).

**Klassen zusammensetzen:** `cn()` aus `src/lib/utils.ts`.

---

## Lernseiten (#107)

Eigene Formsprache, weil sie gelesen und nicht bedient werden:

- **Merkformel:** `border-2 border-black bg-[#f4f5fa] px-6 py-7 text-center` — der schwere Rahmen ist der Punkt, an den das Auge zurückkehrt.
- **Rechenschritt:** `bg-black/[0.05] px-4 py-3` — deutlich leiser. Beide stehen im Beispiel oft nebeneinander und dürfen nicht gleich wichtig wirken.
- **Beispiel-Kasten:** `border-t-4 border-gray-400 bg-[#efeeec] px-6 py-5`, Beschriftung als Mikro-Label mit Symbol davor.
- **Trennlinie:** `border-t-2 border-black`.
- **Video-Platzhalter:** `border-2 border-dashed` — sichtbar unfertig, weil er es ist.
- **Fachbegriff:** `<abbr>` mit `underline decoration-dotted underline-offset-4`.

---

## Sprache

Die Oberfläche ist durchgehend **deutsch**, auch in Fehlermeldungen und `aria-label`. Anführungszeichen deutsch: „…". Im JSX als `&bdquo;` / `&ldquo;`, sonst schlägt `react/no-unescaped-entities` zu.
