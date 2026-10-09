# CP-Röj

En kopia av klassiska Röj (Minesweeper) med:

- **Egna ikoner som minor**: ladda upp en eller flera bilder i admin. Med flera ikoner slumpas en ikon per mina.
- **Egen smileyknapp**: byt smileyn mot egna bilder (PNG m.fl.) – en standardbild och valfritt egna bilder för klick, vinst och förlust.
- **Förlustbild**: när spelaren förlorar rinner rött ned över spelplanen (som i Doom) och avtäcker en egen bild, nedskalad till en pixel per ruta.
- **Egna färger**: alla UI-färger sätts med HEX-koder i adminpanelen, med live-förhandsvisning.
- **Topplista**: den som vinner kan spara namn + mailadress (med samtycke) för att kunna få en rabattkod. Publikt visas bara namn och tid.
- **Inbäddning på Shopify** med två rader kod.
- Tre nivåer (Nybörjare 9×9, Medel 16×16, Expert 30×16), säkert första klick, högerklick/långtryck för flagga, klick på siffra öppnar runt den, eget flagga-läge för mobil.

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

Shopify kan inte köra egen serverkod, så spelet behöver ligga på en egen liten server. Exempel med **Render**:

1. Skapa en ny *Web Service* från det här repot, med *Root Directory* `cp-roj`.
2. Build command: *(tom)* · Start command: `node server.js`.
3. Lägg till en **Disk** (persistent lagring), t.ex. monterad på `/var/data`, och sätt `DATA_DIR=/var/data`.
   Utan persistent disk försvinner topplistan och ikonerna vid varje omstart.
4. Sätt `ADMIN_PASSWORD` och gärna `FRAME_ANCESTORS` till din butiks adresser.

Railway, Fly.io eller en vanlig VPS fungerar lika bra – det viktiga är att `DATA_DIR` ligger på lagring som överlever omstarter.

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

- Topplistan visar topp 10 per nivå, med bästa tiden per mailadress.
- I admin ser du alla resultat med mailadresser, kan bocka i **Meddelad** när du skickat rabattkod, ta bort rader och **exportera CSV** (öppnas direkt i Excel, kan importeras i Shopify Kunder eller Klaviyo).
- Rabattkoderna skickas manuellt (eller via ditt mailverktyg) – spelet skickar inga mail självt.

### Om fusk

Tiden mäts på servern från första klicket till vinst, och orimligt snabba tider (nära världsrekorden) avvisas. Spelet körs ändå i webbläsaren, så en tekniskt kunnig person kan fejka en vinst. Titta därför igenom topplistan innan du delar ut rabattkoder.

### GDPR

Mailadresser sparas bara om spelaren kryssar i samtyckesrutan. Skriv in en länk till din integritetspolicy under *Texter* i admin, och radera uppgifter när de inte längre behövs (knappen *Töm topplistan* eller enskilda rader).

## Filer

```
cp-roj/
├── server.js          Server + API (inga beroenden)
├── public/
│   ├── game.html/css/js  Själva spelet
│   ├── embed.js          Inbäddningsskript för Shopify
│   └── admin.*           Adminpanelen
└── data/              Skapas automatiskt: config.json, scores.json, uploads/
```
