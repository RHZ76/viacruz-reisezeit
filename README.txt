viacruz Reisezeit v0.2.9

Rasterkorrektur für Datum-/Zeitfelder in Campingplatz > Saison & Aufenthalt.

viacruz Reisezeit v0.2.1

Ausbaustufe:
- bestehendes Grundlayout aus v0.1.0 beibehalten
- Campingplatz: neue Bearbeitungsmaske für Grunddaten
- Campingplatz: Saison & Aufenthalt
- responsive Raster für iPhone und Windows
- bestehende lokale Daten bleiben kompatibel
- Suche berücksichtigt zusätzlich Ort und Reiseregionen

Noch nicht Bestandteil dieser Ausbaustufe:
- Stellplatz-/Hotel-/Ferienunterkunft-Detailmasken
- Campingplatz: Stellplatz, Sanitär, Versorgung, Freizeit, Hund und Preise
- Bilderverwaltung
- Karte/Marker/Navigation
- erweiterte Filter

Technik: Cache-Aktualisierung für GitHub Pages/PWA gehärtet (v0.2.1-r2).


v0.3.40: Bilder werden getrennt in IndexedDB gespeichert. Bestehende Base64-Bilder werden beim Start automatisch migriert; localStorage enthält danach nur Bildmetadaten. Backup/Restore schließt Bilddaten weiterhin ein.

v0.3.41: Reiseziel/Ausflugsziel erhält die Karte „Eintritt & Kosten“ mit bedingten Eintritts- und Parkpreisfeldern, weiteren Kosten, Preisjahr und Preishinweisen.


v0.3.46:
- Urlaub: Grunddaten in der Detailansicht standardmäßig eingeklappt
- Urlaub: Aktionskarte Drucken · Speichern · Teilen mit PDF-Ausgabe für Unterkunft und Reiseziel/Ausflugsziel


v0.3.47:
- Intelligente Freitextsuche über Typ, Ort/Region/Land, Kategorien, Aktivitäten und relevante Ausstattungsmerkmale.
- Mehrere Suchwörter werden mit UND-Logik kombiniert.
- Trefferansicht mit Suchgründen, Bewertung/Sternen und Sortierung nach Relevanz, Bewertung oder Name.
- Noch keine Schnellfilter; diese folgen als separater Ausbauschritt.
