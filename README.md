# ioBroker.rainpoint

Unoffizieller ioBroker-Adapter für **RainPoint**-Bewässerung über die **RainPoint-App** und das **WLAN-Gateway**.

Der Adapter verbindet sich mit der HomGar-/RainPoint-Cloud, erkennt Gateway, Ventile und Sensoren und legt sie als ioBroker-States an. Es gibt kein lokales Steuerungsprotokoll — ohne Internet keine Schaltung.

> Dieser Adapter ist **nicht** von RainPoint oder HomGar.

## Features

- Login bei **RainPoint** (WLAN-Gateway) oder HomGar
- Automatische Erkennung von Home, Gateway und Untergeräten
- Ventile pro Zone ein/aus, mit Laufzeit in Minuten
- Sensorwerte: Bodenfeuchte, Temperatur, Regen, Luftfeuchte, Druck, Batterie, RSSI
- Gateway-Status (online, Firmware, WLAN-RSSI)

**Nicht unterstützt:** ältere Tuya-/RainPoint-TY-Geräte (T-Serie). Dafür den Tuya-Adapter verwenden.

## Voraussetzungen

- ioBroker mit js-controller 5 oder neuer
- Node.js 20 oder neuer
- RainPoint-H-Serie: WLAN-Gateway (HWG/HIS) plus Funk-Ventile (HTV …) und optional Sensoren (HCS)
- Konto der **RainPoint**-App (nicht RainPoint-TY)

## Wichtig: nur eine Cloud-Session pro Konto

Ein Login über den Adapter meldet die Handy-App ab. Deshalb ein **zweites Konto** nur für ioBroker anlegen:

1. In der RainPoint-App abmelden
2. Zweites Konto mit einer anderen E-Mail erstellen
3. Mit dem Hauptkonto wieder anmelden
4. **Me → Home management → Members → Invite**
5. Einladung mit dem zweiten Konto annehmen
6. Dieses zweite Konto in der Adapter-Konfiguration eintragen

## Installation

### Von GitHub (empfohlen)

Auf dem ioBroker-Host:

```bash
iobroker url https://github.com/Kuebi7/ioBroker.rainpoint/tarball/main
iobroker add rainpoint
```

Falls `iobroker url` nicht verfügbar ist:

```bash
cd /opt/iobroker
npm install https://github.com/Kuebi7/ioBroker.rainpoint/tarball/main
iobroker upload rainpoint
iobroker add rainpoint
```

Unter Windows liegt das ioBroker-Verzeichnis oft unter `C:\iobroker`.

### Aus dem Quellcode

```bash
git clone https://github.com/Kuebi7/ioBroker.rainpoint.git
cd ioBroker.rainpoint
npm install
npm run build
npm pack
iobroker install ./iobroker.rainpoint-0.1.2.tgz
iobroker add rainpoint
```

Danach Instanz in der Admin-Oberfläche öffnen und speichern.

## Konfiguration

In der Instanz **rainpoint.0**:

| Feld | Wert |
|---|---|
| App | **RainPoint (WLAN Gateway)** |
| Ländervorwahl | Land beim Anlegen des Kontos in der App, z. B. `49` |
| Cloud-Region | International |
| E-Mail / Passwort | Zugangsdaten des Extra-Kontos |

Fehler **2001** bedeutet fast immer: Passwort neu speichern, Ländervorwahl prüfen, oder die Handy-App ist **RainPoint-TY** statt RainPoint Home.
| Home-Index | `0` = erstes Home |
| Abfrageintervall | Standard 120 Sekunden |
| Standard-Bewässerungsdauer | Minuten, wenn eine Zone eingeschaltet wird |

## States

Beispiel für Instanz `rainpoint.0`:

```
rainpoint.0.info.connection
rainpoint.0.info.homeName
rainpoint.0.info.lastUpdate

rainpoint.0.devices.<gateway>.name
rainpoint.0.devices.<gateway>.online
rainpoint.0.devices.<gateway>.rssi

rainpoint.0.devices.<ventil>.zones.1.on          # schreiben: true/false
rainpoint.0.devices.<ventil>.zones.1.duration    # Minuten, vor dem Start setzen
rainpoint.0.devices.<ventil>.zones.1.remaining   # Restlaufzeit in Sekunden

rainpoint.0.devices.<sensor>.moisture            # %
rainpoint.0.devices.<sensor>.temperature         # °C
rainpoint.0.devices.<sensor>.rain.last24h        # mm
```

Eine Zone starten:

1. `zones.1.duration` auf z. B. `15` setzen
2. `zones.1.on` auf `true` setzen

Zum Stoppen `zones.1.on` auf `false` setzen.

## Bekannte Grenzen

- Nur Cloud, kein lokales LAN-Protokoll
- Polling (Standard 2 Minuten), noch kein MQTT-Push
- Unbekannte Modelle erscheinen, Werte können unvollständig sein
- RainPoint-TY / Tuya bleibt außen vor

## Fehler 9993 (operate too frequently)

Die Cloud sperrt Logins, wenn zu oft angemeldet wird (Adapter-Neustarts, falsches Passwort, App und Adapter gleichzeitig). **Instanz nicht neu starten.** Nach ein paar Minuten versucht der Adapter den Login selbst erneut. Wenn die Sperre weiter gilt, 5 Minuten warten und erst dann die Instanz starten.

## Fehler 2001 (Wrong account or password)

Passwort in den Einstellungen neu eingeben, Ländervorwahl des Kontos (nicht die Telefonnummer) setzen und RainPoint Home / HomGar verwenden — nicht RainPoint-TY.

## Entwicklung

```bash
npm install
npm run build
npm test
npm run lint
```

API und Payload-Dekoder orientieren sich an:

- [homebridge-rainpoint](https://github.com/lukezbihlyj/homebridge-rainpoint)
- [homeassistant-homgar](https://github.com/brettmeyerowitz/homeassistant-homgar)
- [homgarapi](https://github.com/Remboooo/homgarapi)

## Changelog

### 0.1.2

- Cloud-Fehler 9993: 3 Minuten Pause statt sofortigem Neu-Login
- Bei falschem Passwort (2001) 10 Minuten warten, statt die Cloud zu überlasten
- Instanz während der Pause nicht neu starten

### 0.1.1

- Login versucht automatisch RainPoint und HomGar
- Gleicher Cloud-Host wie die Home-Assistant-Integration
- Klarere Hinweise bei Fehler 2001 (falsches Passwort, Land oder App)

### 0.1.0

- Erstes Release: Cloud-Login, Gateway- und Geräteerkennung, Ventilsteuerung, Sensor-Polling

## Lizenz

MIT © Andreas
