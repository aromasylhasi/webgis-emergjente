# WebGIS Emergjente — Kosovë
## Udhëzues për hapjen e projektit

### Si ta hapësh:

1. Hap terminal/cmd brenda folderit `webgis-emergjente/`
2. Shkruaj: `python -m http.server 8080`
3. Hap browser dhe shko te: `http://localhost:8080`

### Struktura e skedarëve:
- `index.html` — aplikacioni kryesor
- `css/style.css` — stilizimi
- `js/app.js` — logjika e hartës
- `js/data.js` — të dhënat GeoJSON (stacionet, incidentet)

### Funksionet:
- Harta interaktive me Leaflet.js
- 4 basemap: OSM, Topografi, Satelit, Errët
- Shtresat: Policia, Zjarrfikës, Ambulancë, Spitale, Incidente, VGI, Zona rreziku
- Filtrim sipas llojit të incidentit
- Simbolizim sipas ashpërsisë / llojit / statusit
- Analiza Buffer (kliko Buffer → kliko hartë → jep rreze km)
- Matja e distancave
- Formulari VGI për raportim nga qytetarët
- Shkarkim i të dhënave si GeoJSON
- WMS/WFS URL për palë të treta
