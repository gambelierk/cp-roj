# CP-Röj

En kopia av klassiska Röj (Minesweeper) med:

- **Egna ikoner som minor**: ladda upp en eller flera bilder i admin. Med flera ikoner slumpas en ikon per mina.
- **Egen smileyknapp**: byt smileyn mot egna bilder (PNG m.fl.) – en standardbild och valfritt egna bilder för klick, vinst och förlust.
- **Egen flagga**: byt flaggan på flaggade rutor (och på flagga-knappen) mot en egen bild.
- **Förlustbild**: när spelaren förlorar rinner rött ned över spelplanen (som i Doom) och avtäcker en egen bild, nedskalad till en pixel per ruta.
- **Egna färger**: alla UI-färger sätts med HEX-koder i adminpanelen, med live-förhandsvisning.
- **Topplista med rabattkod**: den som vinner skriver in sitt namn på topplistan och får direkt en rabattkod (standard: *Överste CP-Röj*, ändras i admin).
- **Statistik**: admin visar hur många omgångar som har påbörjats (första klicket) och avslutats (vunna och förlorade), totalt och per dag.
- **Inbäddning på Shopify** med två rader kod.
- Klassisk spelplan 9×9 med 10 minor, säkert första klick, högerklick/långtryck för flagga, klick på siffra öppnar runt den, eget flagga-läge för mobil.

Inga npm-beroenden. Kräver bara Node.js 18 eller senare.

## Kör lokalt

```bash
cd cp-roj
ADMIN_PASSWORD=valfrittlösenord npm start
```

- Spelet: http://localhost:3000/game
- Admin: http://localhost:3000/admin (användarnamn `admin`, lösenordet ovan)

## Miljövariabler

| Variabel | Beskrivning |
| --- | --- |
| `ADMIN_PASSWORD` | **Krävs** för adminpanelen. Utan den är admin avstängd. |
| `ADMIN_USER` | Användarnamn till admin (standard `admin`). |
| `PORT` | Port (standard `3000`). Sätts automatiskt av de flesta värdtjänster. |
| `DATA_DIR` | Mapp där inställningar, topplista och ikoner sparas (standard `./data`). |
| `FRAME_ANCESTORS` | Vilka sajter som får bädda in spelet, t.ex. `https://dinbutik.se https://dinbutik.myshopify.com`. Standard `*` (alla). |

## Driftsättning

Shopify kan inte köra egen serverkod, så spelet behöver ligga på en egen liten server. Repot innehåller en färdig konfiguration för **Render** (`render.yaml`).

### Render

1. Logga in på [render.com](https://render.com) och koppla ditt GitHub-konto (ge Render åtkomst till repot `cp-roj`).
2. Välj **New → Blueprint** och välj repot `cp-roj`.
3. Render läser `render.yaml` och föreslår en webbtjänst med en disk på 1 GB. Fyll i **ADMIN_PASSWORD** (lösenordet till adminpanelen) och klicka **Apply**.
4. När den är klar får du en adress, t.ex. `https://cp-roj.onrender.com`:
   - Spelet: `https://cp-roj.onrender.com/game`
   - Admin: `https://cp-roj.onrender.com/admin` (användarnamn `admin`)

Inställningar, topplista och uppladdade bilder sparas på disken (`/var/data`) och finns kvar vid omstarter och nya versioner. Varje push till `main` driftsätts automatiskt.

**Kostnad:** disk kräver en betald plan (*Starter*, ca 7 USD/mån, plus ca 0,25 USD/mån för disken). Planen kan ändras i `render.yaml` eller i Render.

**Tips:** när du vet butikens adresser, ändra `FRAME_ANCESTORS` under *Environment* i Render till t.ex. `https://dinbutik.se https://dinbutik.myshopify.com`, så kan spelet bara bäddas in i din butik.

Vill du ha en egen adress, t.ex. `spel.dinbutik.se`, lägg till den under *Settings → Custom Domains* i Render.

### Andra värdar

Railway, Fly.io eller en vanlig VPS fungerar lika bra: starta med `node server.js` och se till att `DATA_DIR` pekar på lagring som överlever omstarter.

## Bädda in på Shopify

1. Öppna **Webbshop → Teman → Anpassa** och gå till sidan där spelet ska visas.
2. **Lägg till sektion → Anpassad Liquid**.
3. Klistra in (koden med rätt adress finns också under *Inbäddning* i adminpanelen):

```html
<div id="cp-roj"></div>
<script src="https://DIN-SERVER/embed.js" async></script>
```

Spelet laddas i en iframe som automatiskt anpassar sin höjd, så butikens tema och spelets stil inte påverkar varandra.

## Topplista och rabattkoder

- När spelaren vinner skriver hen in sitt namn. Efter att namnet har sparats visas rabattkoden med en knapp för att kopiera den.
- Rabattkoden och texten ovanför den ändras under *Utseende → Texter* i admin. **Skapa en rabattkod med exakt samma namn i Shopify** under *Rabatter*, annars fungerar den inte i kassan.
- Koden finns inte i spelets publika kod, den skickas bara från servern efter en sparad vinst.
- Placeringen avgörs av tid: snabbaste vinsten hamnar överst. Topplistan visar topp 10, med bästa tiden per namn (vid lika tid går den som spelade först före). I admin ser du alla resultat, kan ta bort olämpliga namn och exportera CSV.

## Statistik

Under *Statistik* i admin visas:

- **Påbörjade omgångar**: spelaren har klickat på första rutan.
- **Avslutade omgångar**: vunna plus förlorade. Skillnaden mot påbörjade är omgångar som avbröts.
- Samma siffror per dag (svensk tid), plus andel vunna.

Spel i adminpanelens förhandsvisning räknas inte. Statistiken sparas i `stats.json` i `DATA_DIR` och kan nollställas i admin.

### Om fusk

Tiden mäts på servern från första klicket till vinst, och orimligt snabba vinster (under 1 sekund) avvisas. Spelet körs ändå i webbläsaren, så en tekniskt kunnig person kan fejka en vinst och få se rabattkoden. Använd därför en kod med en rimlig rabatt, gärna med begränsat antal användningar per kund i Shopify.

## Filer

```
cp-roj/
├── server.js          Server + API (inga beroenden)
├── public/
│   ├── game.html/css/js  Själva spelet
│   ├── embed.js          Inbäddningsskript för Shopify
│   └── admin.*           Adminpanelen
└── data/              Skapas automatiskt: config.json, scores.json, stats.json, uploads/
```
