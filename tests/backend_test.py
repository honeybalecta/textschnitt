#!/usr/bin/env python3
"""Prüfungen des Backends ohne Browser: sicheres Speichern, frühere Fassungen, Papierkorb, Speicher verwalten,
alle Projekte sichern und einspielen, Projekt weitergeben, Vorschaubild der Projektliste, Textzeile und Untertitel im Export,
Quellenzeilen und Textfassung, Schrift im Export (Größe und Umbruch wie in der Vorschau), Hinweis aus dem eigenen Wörterbuch für Whisper,
Ton (Verlauf für „Musik weicht der Sprache“, „Stimme aufbereiten“) und Übergänge im Export, Belege im Bild (unkenntlich gemachte
Bereiche, Formen und Fortschrittsbalken im Export), Hinweis auf neue Versionen, Fehlerbericht.
Läuft in einem frischen Datenordner; nichts verlässt den Rechner (GitHub ist nachgestellt).
Aufruf: python3 tests/backend_test.py            alles
        python3 tests/backend_test.py ton_234    nur ein Teil (Name der Funktion)"""
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODE = sys.argv[1] if len(sys.argv) > 1 else "alles"
TMP = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp(prefix="honeycut-test-"))
os.environ["TEXTSCHNITT_DATA"] = str(TMP / ("umzug" if MODE == "umzug" else "daten"))
os.environ["HF_HUB_CACHE"] = str(TMP / "hf")
os.environ["HONEYCUT_UPDATE_API"] = "test://releases"
sys.path.insert(0, str(Path(os.environ.get("HC_REPO") or HERE.parent)))
import textschnitt as T  # noqa: E402

T.log = lambda msg: None      # das Protokoll der Prüfungen selbst interessiert hier nicht
N = BAD = 0


def chk(name, ok, extra=""):
    global N, BAD
    N += 1
    BAD += not ok
    print(("ok     " if ok else "FEHLER ") + name + (f" · {extra}" if extra != "" else ""), flush=True)


def mk(p: Path, data, age=3600):
    """Datei anlegen – als wäre sie schon eine Stunde alt (frisch erzeugte Dateien gelten dem Speicher-Aufräumen als „in Arbeit“)."""
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
    if age:
        t = time.time() - age
        os.utime(p, (t, t))


def proj(pid):
    return json.loads((T.PROJ_DIR / f"{pid}.json").read_text(encoding="utf-8"))


def job():
    return {"cancel": False, "progress": 0, "message": ""}


D = T.DATA_DIR
ZIP = str(TMP / "sicherung.zip")


def speichern_und_fassungen():
    T.save_project("s1", json.dumps({"id": "s1", "name": "Erster Stand", "updated": 1000, "deleted": []}))
    chk("Projekt wird gespeichert und wieder gelesen", json.loads(T.load_project("s1"))["name"] == "Erster Stand")
    for bad, why in (('{"id": "s1", "name": "abgeschn', "abgeschnittener Stand"), ('{"name": "ohne Kennung"}', "Stand ohne Kennung"), ("[]", "kein Projekt")):
        try:
            T.save_project("s1", bad)
            chk(f"{why} wird abgewiesen", False)
        except ValueError:
            chk(f"{why} wird abgewiesen, der letzte gute Stand bleibt", proj("s1")["name"] == "Erster Stand")
    # Fassungen: der vorige Stand wird zurückgelegt, höchstens sechs bleiben
    f = T.proj_path("s1")
    for k in range(8):
        T.backup_project(f, force=True)
        T.save_project("s1", json.dumps({"id": "s1", "name": f"Stand {k}", "updated": 2000 + k, "deleted": list(range(k))}), backup=False)
    vs = T.project_versions("s1")
    chk("es bleiben die letzten sechs Fassungen, jüngste zuerst", len(vs) == 6 and [v["name"] for v in vs][:2] == ["Stand 6", "Stand 5"] and vs[0]["cut"] == 6, [v["name"] for v in vs])
    chk("zwei Sicherungen in derselben Sekunde überschreiben einander nicht", len({v["file"] for v in vs}) == 6)
    # unlesbare Projektdatei: beim Öffnen kommt die jüngste Fassung zurück
    f.write_bytes(b"\x00\x00kaputt")
    got = json.loads(T.load_project("s1"))
    chk("unlesbares Projekt wird beim Öffnen aus der jüngsten Fassung wiederhergestellt", got["name"] == "Stand 6" and proj("s1")["name"] == "Stand 6", got["name"])
    # Fassung als Kopie und an Ort und Stelle
    r = T.restore_version("s1", vs[3]["file"], True)
    chk("Fassung als Kopie: eigenes Projekt, Original unberührt", r["id"] != "s1" and proj(r["id"])["name"].startswith("Stand 3 (Fassung vom") and proj("s1")["name"] == "Stand 6")
    n = len(T.project_versions("s1"))
    T.restore_version("s1", vs[3]["file"], False)
    chk("Fassung zurückholen: der bisherige Stand liegt danach selbst bei den Fassungen", proj("s1")["name"] == "Stand 3" and T.project_versions("s1")[0]["name"] == "Stand 6" and len(T.project_versions("s1")) <= max(n + 1, 6))
    try:
        T.restore_version("s1", "../../etc/passwd", False)
        chk("erfundener Dateiname wird abgewiesen", False)
    except ValueError:
        chk("erfundener Dateiname wird abgewiesen", True)
    # Papierkorb
    T.delete_project(r["id"])
    T.delete_project("s1")
    tl = T.trash_list()
    chk("gelöschte Projekte liegen im Papierkorb (30 Tage)", sorted(t["id"] for t in tl) == sorted(["s1", r["id"]]) and all(t["left"] == 30 for t in tl) and T.trash_count() == 2, [(t["id"], t["left"]) for t in tl])
    T.trash_restore("s1")
    chk("Wiederherstellen bringt den letzten Stand zurück", proj("s1")["name"] == "Stand 3" and T.trash_count() == 1)
    try:
        T.trash_restore("s1")
        chk("vorhandenes Projekt wird nicht überschrieben", False)
    except ValueError:
        chk("vorhandenes Projekt wird nicht überschrieben", True)
    T.trash_purge(r["id"])
    chk("endgültig löschen entfernt nur das gemeinte Projekt", T.trash_count() == 0 and T.proj_path("s1").exists() and T.project_versions("s1"))
    # nach 30 Tagen räumt der Start von selbst auf
    T.save_project("alt", json.dumps({"id": "alt", "name": "Altes", "updated": 1}))
    T.delete_project("alt")
    old = time.time() - 31 * 86400
    for x in (T.BACKUP_DIR / "alt").iterdir():
        os.utime(x, (old, old))
    os.utime(T.BACKUP_DIR / "alt", (old, old))
    check, T.update_check = T.update_check, lambda force=False: None     # das Aufräumen stößt sonst die Versionsprüfung an
    T.housekeeping()
    T.update_check = check
    chk("Papierkorb leert sich nach 30 Tagen von selbst", not (T.BACKUP_DIR / "alt").exists() and T.proj_path("s1").exists())
    T.delete_project("s1")
    T.trash_purge(None)


def speicher():
    px, mt, fo = T.CACHE_DIR / "proxies", D / "freigestellt", D / "folien"
    for k in range(40):
        mk(T.CACHE_DIR / "thumbs" / f"t{k}.jpg", b"x" * 2000)
    mk(px / "aaaaaaaaaaaaaaaa.mp4", b"x" * 3_000_000)      # von p1 verwendet
    mk(px / "bbbbbbbbbbbbbbbb.mp4", b"x" * 4_000_000)      # verwaist
    mk(mt / "cccccccccccccccc.mp4", b"x" * 500_000)        # von p1 verwendet
    mk(mt / "dddddddddddddddd.mp4", b"x" * 600_000)        # nur in einer früheren Fassung von p1
    mk(mt / "eeeeeeeeeeeeeeee.mp4", b"x" * 700_000)        # verwaist
    mk(fo / "p1" / "folie-s1-3.png", b"x" * 100_000)
    mk(fo / "p1" / "folie-s1-2.png", b"x" * 90_000)
    mk(fo / "p1" / "folie-s1-1.png", b"x" * 80_000)
    mk(fo / "p1" / "folienbild-x.png", b"x" * 70_000)
    mk(fo / "weg" / "folie-z9-1.png", b"x" * 60_000)       # das Projekt gibt es nicht mehr
    mk(fo / "trash1" / "folie-q7-1.png", b"x" * 50_000)    # das Projekt liegt im Papierkorb
    p1 = {"id": "p1", "name": "Rede zum Haushalt", "sources": [{"uri": str(mt / "cccccccccccccccc.mp4"), "proxy": str(px / "aaaaaaaaaaaaaaaa.mp4"), "duration": 60}],
          "items": [{"clip": {"uri": str(fo / "p1" / "folie-s1-3.png")}}, {"clip": {"uri": str(fo / "p1" / "folienbild-x.png")}}]}
    mk(T.PROJ_DIR / "p1.json", json.dumps(p1))
    old = dict(p1, sources=[{"uri": str(mt / "dddddddddddddddd.mp4")}], items=[{"clip": {"uri": str(fo / "p1" / "folie-s1-2.png")}}])
    mk(T.BACKUP_DIR / "p1" / "20261101-100000.json.gz", gzip.compress(json.dumps(old).encode()))
    mk(T.BACKUP_DIR / "trash1" / "20261110-100000-geloescht.json.gz", gzip.compress(json.dumps({"id": "trash1", "name": "Altes", "items": [{"clip": {"uri": str(fo / "trash1" / "folie-q7-1.png")}}]}).encode()))
    mk(TMP / "hf" / "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo" / "blobs" / "m.bin", b"x" * 900_000)
    info = T.storage_info()
    g = {x["key"]: x for x in info["groups"]}
    chk("Übersicht: Größen aller Gruppen und freier Platz", g["thumbs"]["count"] == 40 and g["proxies"]["bytes"] == 7_000_000 and g["matte"]["bytes"] == 1_800_000 and g["slides"]["count"] == 6
        and g["models"]["bytes"] == 900_000 and info["free"] > 0 and not info["problem"], {k: v["bytes"] for k, v in g.items()})
    chk("Vorschau-Dateien: nur die verwaiste ist freigebbar", g["proxies"]["nfree"] == 1 and g["proxies"]["freeable"] == 4_000_000)
    used = {i["name"][:1]: i["used"] for i in g["matte"]["items"]}
    chk("freigestellte Kopien: Verwendung in Projekt und früherer Fassung wird genannt", used == {"c": ["„Rede zum Haushalt“"], "d": ["einer früheren Fassung von „Rede zum Haushalt“"], "e": []}, used)
    chk("Folienbilder: frühere Bilder freigebbar; Papierkorb und frühere Fassungen zählen als verwendet", g["slides"]["nfree"] == 2 and g["slides"]["freeable"] == 140_000)
    r = T.storage_clear("proxies")
    chk("Vorschau-Dateien löschen: nur die verwaiste", r["count"] == 1 and (px / "aaaaaaaaaaaaaaaa.mp4").exists() and not (px / "bbbbbbbbbbbbbbbb.mp4").exists())
    r = T.storage_clear("matte", "cccccccccccccccc.mp4")
    chk("verwendete freigestellte Kopie lässt sich nicht löschen", r["count"] == 0 and (mt / "cccccccccccccccc.mp4").exists())
    r = T.storage_clear("matte")
    chk("unbenutzte freigestellte Kopie wird gelöscht, die übrigen bleiben", r["count"] == 1 and r["freed"] == 700_000 and (mt / "dddddddddddddddd.mp4").exists() and not (mt / "eeeeeeeeeeeeeeee.mp4").exists())
    r = T.storage_clear("slides")
    left = sorted(x.name for x in fo.rglob("*.png"))
    chk("Folienbilder: frühere weg, verwendete und eigene bleiben, leerer Ordner entfernt", r["count"] == 2 and left == ["folie-q7-1.png", "folie-s1-2.png", "folie-s1-3.png", "folienbild-x.png"] and not (fo / "weg").exists(), left)
    r = T.storage_clear("thumbs")
    chk("Vorschaubilder leeren", r["count"] == 40 and r["freed"] == 80_000)
    # eben erst erzeugte Dateien stehen womöglich noch in keinem gespeicherten Projekt: Sie bleiben liegen
    mk(mt / "1212121212121212.mp4", b"x" * 1000, age=0)
    mk(px / "3434343434343434.mp4", b"x" * 1000, age=0)
    mk(fo / "p1" / "folie-neu-1.png", b"x" * 1000, age=0)
    g = {x["key"]: x for x in T.storage_info()["groups"]}
    fresh = next(i for i in g["matte"]["items"] if i["name"].startswith("1212"))
    n = sum(T.storage_clear(w)["count"] for w in ("matte", "proxies", "slides")) + T.storage_clear("matte", "1212121212121212.mp4")["count"]
    chk("eben erst erzeugte Dateien gelten als in Arbeit und bleiben liegen", g["matte"]["nfree"] == 0 and g["proxies"]["nfree"] == 0 and g["slides"]["nfree"] == 0 and "laufenden Vorgang" in fresh["used"][0]
        and n == 0 and (mt / "1212121212121212.mp4").exists() and (px / "3434343434343434.mp4").exists() and (fo / "p1" / "folie-neu-1.png").exists(), fresh["used"])
    for x in (mt / "1212121212121212.mp4", px / "3434343434343434.mp4", fo / "p1" / "folie-neu-1.png"):
        x.unlink()
    r = T.storage_clear("model", "large-v3-turbo")
    chk("nachgeladenes Modell löschen", r["freed"] == 900_000 and not list((TMP / "hf").glob("models--*")))
    for what in ("unsinn", "model"):
        try:
            T.storage_clear(what, "gibt-es-nicht")
            chk(f"unbekannte Angabe ({what}) wird abgewiesen", False)
        except ValueError:
            chk(f"unbekannte Angabe ({what}) wird abgewiesen", True)
    mk(mt / "ffffffffffffffff.mp4", b"x" * 1000)
    mk(T.PROJ_DIR / "kaputt.json", b"\xff\xfe\x00")
    try:
        T.storage_clear("matte")
        chk("unlesbares Projekt: es wird nichts gelöscht", False)
    except Exception:  # noqa: BLE001
        chk("unlesbares Projekt: es wird nichts gelöscht", (mt / "ffffffffffffffff.mp4").exists())
    info = T.storage_info()
    chk("unlesbares Projekt: die Übersicht erklärt, warum nichts freigebbar ist", bool(info["problem"]) and all(not x.get("nfree") for x in info["groups"]))
    (T.PROJ_DIR / "kaputt.json").unlink()
    for x in (T.PROJ_DIR / "p1.json", mt / "ffffffffffffffff.mp4"):
        x.unlink()
    T._list_cache.clear()
    T.trash_purge(None)


def sicherung():
    mk(T.FONT_DIR / "Meine Schrift.ttf", b"FONT-A" * 100)
    mk(T.FONT_DIR / "Zweite.otf", b"FONT-B" * 50)
    f1 = T.norm_path(str(T.FONT_DIR / "Meine Schrift.ttf"))
    key1 = "u" + T._js_hash(f1)
    s1, s2, s3 = (T.norm_path(str(D / "folien" / a / b)) for a, b in (("b1", "folie-a1-2.png"), ("b1", "eigenes-bild.png"), ("andere", "folie-z-1.png")))
    mk(Path(s1), b"\x89PNG-1" * 1000)
    mk(Path(s2), b"\x89PNG-2" * 500)
    mk(Path(s3), b"\x89PNG-3" * 200)
    mk(D / "folien" / "b1" / "folie-a1-1.png", b"\x89PNG-alt")           # früheres Bild, von keinem Projekt verwendet
    mk(D / "freigestellt" / "9999999999999999.mp4", b"V" * 2_000_000)     # Videos bleiben draußen
    T.save_project("b1", json.dumps({"id": "b1", "name": "Rede zum Haushalt", "updated": 2000, "sources": [{"uri": "/videos/rede.mp4", "name": "rede.mp4", "duration": 60}],
                                     "sub_style": {"font": key1}, "items": [{"font": key1, "clip": {"uri": s1}}, {"clip": {"uri": s3}}], "slides": [{"img": s2}],
                                     "tokens": [{"type": "word", "text": "u1abc"}]}, ensure_ascii=False))
    T.save_project("b2", json.dumps({"id": "b2", "name": "Interview", "updated": 3000, "sources": [{"uri": str(D / "freigestellt" / "9999999999999999.mp4"), "orig": "/videos/interview.mp4"}]}))
    T.save_project("b3", json.dumps({"id": "b3", "name": "Kurzclip", "updated": 4000, "sources": []}))
    mk(T.PROJ_DIR / "kaputt.json", b"{nicht lesbar")
    r = T.backup_all_job(job(), ZIP, {"hc-colfav": ["#E5402A"], "hc-slide-profiles": [{"id": "mein", "name": "Mein Profil", "colors": {}}],
                                      "hc-fillers": ["halt", "ich sag mal"], "hc-sub-looks": [{"id": "l1", "name": "Kampagne", "st": {"font": key1, "color": "#EDE7DA"}}]})
    with zipfile.ZipFile(ZIP) as z:
        names, meta = sorted(z.namelist()), json.loads(z.read("sicherung.json"))
    chk("Sicherung enthält Projekte, verwendete Bilder, Schriften, Einstellungen – ohne Videos und ohne unbenutzte Bilder",
        names == ["einstellungen.json", "folien/andere/folie-z-1.png", "folien/b1/eigenes-bild.png", "folien/b1/folie-a1-2.png", "projekte/b1.json", "projekte/b2.json",
                  "projekte/b3.json", "schriften/Meine Schrift.ttf", "schriften/Zweite.otf", "sicherung.json"], names)
    chk("Ergebnis stimmt; ein unlesbares Projekt wird genannt und hält nichts auf", r["projects"] == 3 and r["slides"] == 3 and r["fonts"] == 2 and r["skipped"] == ["kaputt"]
        and meta["format"] == "honeycut-sicherung" and r["bytes"] < 200_000 and not Path(ZIP + ".part").exists(), r)
    (T.PROJ_DIR / "kaputt.json").unlink()
    # Zustand danach: b2 gelöscht, b3 hier neuer, b1 hier älter
    T.delete_project("b2")
    o = proj("b3")
    o.update(updated=9000, name="Kurzclip (weiterbearbeitet)")
    T.save_project("b3", json.dumps(o), backup=False)
    o = proj("b1")
    o.update(updated=1000, name="Rede (alter Stand)")
    T.save_project("b1", json.dumps(o), backup=False)
    r = T.backup_restore_job(job(), ZIP)
    chk("Einspielen: Fehlendes kommt dazu, Älteres wird aktualisiert, Neueres bleibt", r["added"] == ["Interview"] and r["updated"] == ["Rede zum Haushalt"] and r["updatedIds"] == ["b1"]
        and r["kept"] == ["Kurzclip"] and r["same"] == 0 and not r["failed"] and r["total"] == 3, {k: r[k] for k in ("added", "updated", "kept", "same", "failed")})
    chk("der überschriebene Stand liegt bei den früheren Fassungen", proj("b1")["name"] == "Rede zum Haushalt" and [v["name"] for v in T.project_versions("b1")] == ["Rede (alter Stand)"])
    chk("das hier neuere Projekt bleibt; der gesicherte Stand liegt bei seinen Fassungen", proj("b3")["name"] == "Kurzclip (weiterbearbeitet)" and [v["name"] for v in T.project_versions("b3")] == ["Kurzclip"])
    chk("das gelöschte Projekt ist zurück und aus dem Papierkorb verschwunden", proj("b2")["name"] == "Interview" and T.trash_list() == [])
    chk("gleicher Datenordner: Pfade und Schriftschlüssel bleiben", proj("b1")["items"][0]["clip"]["uri"] == s1 and proj("b1")["sub_style"]["font"] == key1 and r["fonts"] == 0 and r["slides"] == 0)
    chk("Designprofile und Farbfavoriten kommen mit zurück", r["prefs"]["hc-colfav"] == ["#E5402A"] and r["prefs"]["hc-slide-profiles"][0]["id"] == "mein")
    chk("eigene Füllwörter und Looks kommen mit zurück", r["prefs"]["hc-fillers"] == ["halt", "ich sag mal"] and r["prefs"]["hc-sub-looks"][0]["st"] == {"font": key1, "color": "#EDE7DA"})
    r = T.backup_restore_job(job(), ZIP)
    chk("zweites Einspielen ändert nichts und legt keine doppelten Fassungen an", r["same"] == 2 and r["kept"] == ["Kurzclip"] and not r["added"] and not r["updated"]
        and len(T.project_versions("b3")) == 1 and len(T.project_versions("b1")) == 1)
    for src, why in ((str(T.PROJ_DIR / "b1.json"), "fremde Datei"), (str(TMP / "fremd.zip"), "fremdes ZIP")):
        if why == "fremdes ZIP":
            with zipfile.ZipFile(src, "w") as zz:
                zz.writestr("irgendwas.txt", "x")
        try:
            T.backup_restore_job(job(), src)
            chk(f"{why} wird abgewiesen", False)
        except ValueError as e:
            chk(f"{why} wird abgewiesen", "keine HoneyCut-Sicherung" in str(e))
    with zipfile.ZipFile(TMP / "boese.zip", "w") as zz:
        zz.writestr("sicherung.json", json.dumps({"format": "honeycut-sicherung", "dataDir": T.norm_path(str(D))}))
        zz.writestr("projekte/../../raus.json", json.dumps({"id": "raus"}))
        zz.writestr("folien/../../../x.png", "x")
        zz.writestr("schriften/../boese.ttf", "x")
        zz.writestr("projekte/ok1.json", json.dumps({"id": "ok1", "name": "Gut", "updated": 5}))
        zz.writestr("projekte/leer.json", "[]")
    r = T.backup_restore_job(job(), str(TMP / "boese.zip"))
    chk("Pfade außerhalb des Datenordners werden nicht geschrieben, Unlesbares wird übersprungen", r["added"] == ["Gut"] and r["failed"] == ["leer"] and not (D.parent / "raus.json").exists()
        and not (D / "raus.json").exists() and not (T.FONT_DIR.parent / "boese.ttf").exists() and sorted(x.name for x in T.PROJ_DIR.glob("*.json")) == ["b1.json", "b2.json", "b3.json", "ok1.json"])
    # dieselbe Sicherung auf einem „anderen Rechner“ (anderer Datenordner) einspielen
    (TMP / "umzug.json").write_text(json.dumps({"key1": key1}))
    out = subprocess.run([sys.executable, __file__, "umzug", str(TMP)], capture_output=True, text=True)
    print(out.stdout, end="")
    global N, BAD
    N += out.stdout.count("\nok ") + out.stdout.startswith("ok ") + out.stdout.count("FEHLER ")
    BAD += out.stdout.count("FEHLER ") + (1 if out.returncode not in (0, 1) else 0)
    if out.returncode not in (0, 1):
        print("FEHLER Einspielen im anderen Datenordner lief nicht durch:", out.stderr[-600:])


def projektpakete():
    """Projekt weitergeben (.honeycut): Was kein Dateipfad ist – etwa ein Bild, das direkt im Projekt steht –, darf weder das
    Paket noch das Freigeben der übrigen Dateien aufhalten. Windows meldet bei mehr als 32 767 Zeichen „stat: path too long
    for Windows“ (ein ValueError); das wird hier nachgestellt, weil andere Systeme an dieser Stelle anders reagieren."""
    import pathlib
    real_resolve = pathlib.Path.resolve

    def win_resolve(self, strict=False):
        if len(str(self)) > 32767:
            raise ValueError("stat: path too long for Windows")
        return real_resolve(self, strict=strict)
    pathlib.Path.resolve = win_resolve
    os.environ["HOME"] = str(TMP / "heim")
    try:
        inline = "data:image/png;base64," + "iVBORw0KGgo/" * 4000          # 48 000 Zeichen, mit Schrägstrichen wie in echten Bilddaten
        try:
            got = T.norm_path(inline)
        except ValueError as e:
            got = f"Abbruch: {e}"
        chk("eingebettete Bilddaten gelten nicht als Dateipfad und bleiben unverändert", got == inline, got[:60])
        vid, logo = TMP / "paket" / "video.mp4", TMP / "paket" / "logo.png"
        mk(vid, b"v" * 5000)
        mk(logo, b"l" * 700)
        obj = {"id": "pk1", "name": "Paket", "sources": [{"uri": inline}, {"uri": str(vid)}], "items": [{"clip": {"uri": str(logo)}}, {"clip": {"uri": inline}}]}
        T.ALLOWED.clear()
        T.allow_all(obj)
        chk("beim Laden werden alle echten Dateien freigegeben, auch wenn daneben eingebettete Daten stehen",
            T.norm_path(str(vid)) in T.ALLOWED and T.norm_path(str(logo)) in T.ALLOWED and inline not in T.ALLOWED, len(T.ALLOWED))
        dest = str(TMP / "paket" / "projekt.honeycut")
        spec = {"name": "Paket", "header": {"format": "honeycut-projekt", "v": 1, "name": "Paket",
                                             "project": {"id": "pk1", "name": "Paket", "slides": [{"id": "s1", "img": inline}]},
                                             "files": [{"n": "m0", "kind": "media", "name": "video.mp4"}, {"n": "m1", "kind": "media", "name": "Datei1"},
                                                       {"n": "m2", "kind": "media", "name": "logo.png"}, {"n": "m3", "kind": "media", "name": "fehlt.mp4"}]},
                "files": [{"n": "m0", "uri": str(vid), "include": True}, {"n": "m1", "uri": inline, "include": True},
                          {"n": "m2", "uri": str(logo), "include": True}, {"n": "m3", "uri": str(TMP / "paket" / "fehlt.mp4"), "include": True}]}
        try:
            res = T.package_export_job(job(), spec, dest)
            err = ""
        except Exception as e:  # noqa: BLE001
            res, err = {}, repr(e)
        hf = {h["n"]: h for h in spec["header"]["files"]}
        chk("das Paket entsteht, auch wenn ein Eintrag eingebettete Daten statt eines Pfads nennt", not err and Path(dest).is_file(), err)
        chk("echte Dateien stecken im Paket, der eingebettete Eintrag und die fehlende Datei zählen als nicht mitgeschickt",
            hf["m0"].get("included") is True and hf["m2"].get("included") is True and hf["m1"].get("included") is False and hf["m3"].get("included") is False
            and hf["m0"].get("size") == 5000 and hf["m2"].get("size") == 700, {k: (v.get("included"), v.get("size")) for k, v in hf.items()})
        chk("neben dem Paket bleibt keine halbfertige Datei liegen", not Path(dest + ".part").exists())
        try:
            back = T.package_import_job(job(), dest)
            err = ""
        except Exception as e:  # noqa: BLE001
            back, err = {}, repr(e)
        mp = back.get("map") or {}
        chk("das Paket lässt sich wieder einlesen: beide Dateien liegen im Importordner, das eingebettete Bild steht weiter im Projekt",
            not err and set(mp) == {"m0", "m2"} and Path(mp["m0"]).read_bytes() == b"v" * 5000 and Path(mp["m2"]).read_bytes() == b"l" * 700
            and back["header"]["project"]["slides"][0]["img"] == inline and str(TMP / "heim") in mp["m0"], err or sorted(mp))
        # Auch kurze Angaben, die das System nicht als Pfad annimmt, führen zu keinem Abbruch

        def bad_resolve(self, strict=False):
            raise ValueError("stat: embedded null character in path")
        pathlib.Path.resolve = bad_resolve
        try:
            got = T.norm_path("C:/Videos/kaputt.mp4")
        except ValueError as e:
            got = f"Abbruch: {e}"
        chk("lässt sich eine Angabe nicht als Pfad auflösen, bleibt sie unverändert statt den Vorgang abzubrechen", got == "C:/Videos/kaputt.mp4", got)
    finally:
        pathlib.Path.resolve = real_resolve


def kleine_helfer():
    """2.27: Vorschaubild in der Projektliste; dauerhafte Textzeile im Export (Ecke, eigene Spur); SRT nur mit Untertiteln."""
    vid = T.norm_path(str(TMP / "videos" / "rede.mp4"))
    mk(Path(vid), b"x")
    T.save_project("h1", json.dumps({"id": "h1", "name": "Mit Video", "updated": 1, "sources": [{"uri": str(TMP / "ton.mp3"), "kind": "audio", "duration": 5}, {"uri": vid, "duration": 10}]}))
    T.save_project("h2", json.dumps({"id": "h2", "name": "Nur Ton", "updated": 2, "sources": [{"uri": str(TMP / "ton.mp3"), "kind": "audio", "duration": 5}]}))
    T.save_project("h3", json.dumps({"id": "h3", "name": "Eingebettet", "updated": 3, "sources": [{"uri": "data:video/mp4;base64," + "A" * 5000, "duration": 5}]}))
    T.ALLOWED.discard(vid)
    T._list_cache.clear()
    lst = {p["id"]: p for p in T.list_projects()}
    chk("Projektliste nennt das erste Video als Quelle des Vorschaubilds; Ton und eingebettete Daten liefern keins",
        lst["h1"]["thumb"] == vid and lst["h2"]["thumb"] == "" and lst["h3"]["thumb"] == "", [lst[k]["thumb"][:40] for k in ("h1", "h2", "h3")])
    chk("das Video ist für das Vorschaubild freigegeben, ohne dass das Projekt geöffnet wurde", vid in T.ALLOWED)
    for k in ("h1", "h2", "h3"):
        T.delete_project(k)
        T.trash_purge(k)
    # Textzeile, Titel und Untertitel, wie sie die Oberfläche in den Exportplan schreibt
    raw = [{"start": 0, "end": 10, "text": "@kanal · V. i. S. d. P.", "x": 0.8, "y": 0.09, "size": 0.028, "title": True, "line": True, "anchor": "or", "mx": 0.06, "my": 0.08, "bg": True, "outline": False, "font": ""},
           {"start": 1, "end": 3, "text": "Ein Titel", "x": 0.5, "y": 0.3, "size": 0.075, "title": True, "font": ""},
           {"start": 1.5, "end": 2.5, "text": "gesprochen"},
           {"start": 0, "end": 10, "text": "unten links", "x": 0.2, "y": 0.9, "size": 0.028, "title": True, "line": True, "anchor": "ul", "mx": 0.035, "my": 0.02, "font": ""},
           {"start": 0, "end": 10, "text": "unten Mitte", "x": 0.5, "y": 0.9, "size": 0.028, "title": True, "line": True, "anchor": "um", "mx": 0.035, "my": 0.02, "font": ""},
           {"start": 0, "end": 10, "text": "kaputt", "title": True, "line": True, "anchor": "xy", "mx": "?"}]
    cues = T.clean_cues(raw)
    by = {c["text"]: c for c in cues}
    chk("Textzeile: Ecke und Randabstand kommen im Export an, unbrauchbare Angaben werden verworfen",
        by["@kanal · V. i. S. d. P."].get("line") is True and by["@kanal · V. i. S. d. P."]["anchor"] == "or" and by["@kanal · V. i. S. d. P."]["mx"] == 0.06 and by["@kanal · V. i. S. d. P."]["my"] == 0.08
        and by["kaputt"].get("line") is True and "anchor" not in by["kaputt"] and "line" not in by["gesprochen"] and "anchor" not in by["Ein Titel"])
    chk("als Untertitel gilt nur Gesprochenes – Titel und Textzeile gehören zum Bild", [c["text"] for c in T.spoken_cues(cues)] == ["gesprochen"])
    srt = TMP / "helfer.srt"
    T.write_srt(T.spoken_cues(cues), srt)
    chk("die SRT-Datei enthält nur die Untertitel", srt.read_text(encoding="utf-8").strip().split("\n") == ["1", "00:00:01,500 --> 00:00:02,500", "gesprochen"], srt.read_text(encoding="utf-8")[:80].replace("\n", " | "))
    ass = TMP / "helfer.ass"
    T.write_ass(cues, {"size": "mittel"}, ass, 1080, 1920, {})
    alle = [ln for ln in ass.read_text(encoding="utf-8-sig").splitlines() if ln.startswith("Dialogue:")]
    ev = {ln.split("}", 1)[1]: ln for ln in alle}
    # Lage wie in der Vorschau: Schriftgröße px (Geviert), Zeilenhöhe 1,12 px, Kasten mit 0,3 px / 0,1 px Rand; die Zeile sitzt an ihrer Ecke
    px, std = 0.028 * 1080 * 1.25, T.standard_face()
    shift = ((std.css[0] - std.css[1]) - (std.cell[0] - std.cell[1])) / 2 * px
    kasten = [ln for ln in alle if "\\p4}" in ln]
    chk("eingebrannt sitzt die Textzeile an ihrer Ecke: oben rechts, mit Kasten um dessen Rand nach innen",
        f"\\an6\\pos({1080 - 0.06 * 1080 - 0.3 * px:.1f},{0.08 * 1920 + 0.1 * px + 0.56 * px + shift:.1f})" in ev["@kanal · V. i. S. d. P."] and len(kasten) == 1
        and f",{0.08 * 1920:.1f})" in kasten[0] and "\\1a&H73&" in kasten[0] and kasten[0].startswith("Dialogue: 0,") and ev["@kanal · V. i. S. d. P."].startswith("Dialogue: 1,"),
        [ev["@kanal · V. i. S. d. P."][:110], kasten[:1]])
    chk("unten links und unten in der Mitte", f"\\an4\\pos({0.035 * 1080:.1f},{1920 - 0.02 * 1920 - 0.56 * px + shift:.1f})" in ev["unten links"]
        and f"\\an5\\pos(540.0,{1920 - 0.02 * 1920 - 0.56 * px + shift:.1f})" in ev["unten Mitte"], [ev["unten links"][:90], ev["unten Mitte"][:90]])
    chk("Titel und Untertitel bleiben über ihren Mittelpunkt gesetzt", "\\an5\\pos(540.0,576.0)" in ev["Ein Titel"] and "\\an5\\pos(540.0," in ev["gesprochen"] and "\\an5" in ev["kaputt"],
        [ev["Ein Titel"][:80], ev["gesprochen"][:80]])
    chk("die Schriftgröße bezieht sich auf das Geviert wie in der Vorschau (libass rechnet in Zellenhöhe)",
        f"\\fnArial\\b1\\fs{0.075 * 1080 * 1.25 * sum(std.cell):.2f}" in ev["Ein Titel"] and f"\\fs{0.058 * 1080 * 1.25 * sum(std.cell):.2f}" in ev["gesprochen"], ev["Ein Titel"][:120])
    # Concat: die Textzeile bekommt ihre eigene Spur, die SRT-Datei daneben enthält nur die Untertitel
    probe0, root0 = T.probe, T.concat_root
    T.probe = lambda p: {"duration": 10.0, "hasVideo": True, "hasAudio": True, "width": 1080, "height": 1920, "fps": 30.0}
    T.concat_root = lambda: TMP / "Concat"
    try:
        folder = T.write_concat({"width": 1080, "height": 1920, "fps": 30, "segments": [{"uri": vid, "in": 0, "out": 10, "kind": "main"}], "overlays": []}, "helfer", cues, {"size": "mittel"})
    finally:
        T.probe, T.concat_root = probe0, root0
    doc = json.loads((folder / "concat.json").read_text(encoding="utf-8"))
    tracks = {c["text"]["content"]: c["trackId"] for c in doc["clips"] if c["kind"] == "text"}
    chk("Concat: Textzeilen liegen auf T4, Titel und Untertitel auf T3", tracks == {"@kanal · V. i. S. d. P.": "T4", "unten links": "T4", "unten Mitte": "T4", "kaputt": "T4", "Ein Titel": "T3", "gesprochen": "T3"}, tracks)
    chk("Concat: die SRT-Datei daneben enthält nur die Untertitel", (folder / "helfer.srt").read_text(encoding="utf-8").count("-->") == 1)


def quellen_und_belege():
    """2.28: Quellenzeilen im Export (Ecke, eigene Spur, nicht in der SRT-Datei); Textfassung neben dem Video."""
    vid = T.norm_path(str(TMP / "videos" / "quellen.mp4"))
    mk(Path(vid), b"x")
    raw = [{"start": 1, "end": 4, "text": "Quelle: Statistisches Bundesamt, 12.03.2025", "x": 0.3, "y": 0.06, "size": 0.024, "title": True, "line": True, "src": True, "anchor": "ol", "mx": 0.035, "my": 0.04, "outline": True, "font": ""},
           {"start": 0, "end": 10, "text": "@kanal", "x": 0.2, "y": 0.9, "size": 0.028, "title": True, "line": True, "anchor": "ul", "mx": 0.035, "my": 0.02, "font": ""},
           {"start": 1.5, "end": 2.5, "text": "gesprochen"}]
    cues = T.clean_cues(raw)
    by = {c["text"]: c for c in cues}
    q = by["Quelle: Statistisches Bundesamt, 12.03.2025"]
    chk("Quellenzeile: Kennzeichen, Ecke und Randabstand kommen im Export an", q.get("src") is True and q.get("line") is True and q["anchor"] == "ol" and q["mx"] == 0.035 and q["my"] == 0.04
        and "src" not in by["@kanal"] and "src" not in by["gesprochen"])
    chk("Quellenzeilen gehören zum Bild und stehen nicht in den Untertiteln", [c["text"] for c in T.spoken_cues(cues)] == ["gesprochen"])
    ass = TMP / "quellen.ass"
    T.write_ass(cues, {"size": "mittel"}, ass, 1920, 1080, {})
    ev = {ln.split("}", 1)[1]: ln for ln in ass.read_text(encoding="utf-8-sig").splitlines() if ln.startswith("Dialogue:")}
    px = 0.024 * 1080
    chk("eingebrannt sitzt die Quellenzeile oben links an ihrem Rand, für die Dauer des Satzes",
        f"\\an4\\pos({0.035 * 1920:.1f},{0.04 * 1080 + 0.56 * px:.1f})" in ev[q["text"]] and "0:00:01.00,0:00:04.00" in ev[q["text"]], ev[q["text"]][:120])
    probe0, root0, render0 = T.probe, T.concat_root, T.render_plan
    T.probe = lambda p: {"duration": 10.0, "hasVideo": True, "hasAudio": True, "width": 1920, "height": 1080, "fps": 30.0}
    T.concat_root = lambda: TMP / "Concat"
    plan = {"width": 1920, "height": 1080, "fps": 30, "segments": [{"uri": vid, "in": 0, "out": 10, "kind": "main"}], "overlays": []}
    try:
        folder = T.write_concat(plan, "quellen", cues, {"size": "mittel"})
        folder2 = T.write_concat(plan, "ohne_quellen", [c for c in cues if not c.get("src")], {"size": "mittel"})
    finally:
        T.probe, T.concat_root = probe0, root0
    doc, doc2 = (json.loads((f / "concat.json").read_text(encoding="utf-8")) for f in (folder, folder2))
    tracks = {c["text"]["content"]: c["trackId"] for c in doc["clips"] if c["kind"] == "text"}
    chk("Concat: Quellenzeilen liegen auf T5, die Textzeile auf T4, Untertitel auf T3", tracks == {q["text"]: "T5", "@kanal": "T4", "gesprochen": "T3"}, tracks)
    ids = lambda d: [t["id"] for t in d["tracks"] if t["id"].startswith("T")]
    chk("Concat: die Spur T5 gibt es nur mit Quellenzeilen", ids(doc) == ["T1", "T3", "T4", "T5"] and ids(doc2) == ["T1", "T3", "T4"], [ids(doc), ids(doc2)])
    # Textfassung: liegt neben dem Video und steht in der Liste der Dateien
    made = []
    T.render_plan = lambda job, plan, out, with_video, cues: (made.append(out), Path(out).write_bytes(b"video"))
    text = "Mieten in der Stadt\nTextfassung des Videos · 0:10\n\nAnna Beispiel (Sprecherin): Die Mieten steigen. [1]\n\nQuellen\n[1] Statistisches Bundesamt (2025)\n"
    base = {"format": "video", "name": "Mieten: Film?", "segments": [{"uri": vid, "in": 0, "out": 10}], "sources": [{"uri": vid}], "subs": {"cues": raw, "style": {}}}
    try:
        r1 = T.export_job(job(), {**base, "textfile": {"name": "egal.txt", "text": text}})
        r2 = T.export_job(job(), {**base, "name": "Ohne Text"})
        r3 = T.export_job(job(), {**base, "name": "Leer", "textfile": {"text": "  "}})
        r4 = T.export_job(job(), {**base, "format": "audio", "audioFormat": "mp3", "name": "Nur Ton", "textfile": {"text": text}})
    finally:
        T.render_plan = render0
    txt = [Path(f) for f in r1["files"] if f.endswith(".txt")]
    chk("Export: Die Textfassung liegt als Textdatei neben dem Video, benannt nach dem Export",
        len(txt) == 1 and txt[0].name == "Mieten_ Film_ – Textfassung.txt" and txt[0].parent == Path(r1["playable"]).parent and txt[0].read_text(encoding="utf-8") == text, [f for f in r1["files"]])
    chk("Export: ohne Textfassung im Plan (oder mit leerem Text) entsteht keine Textdatei", not any(f.endswith(".txt") for f in r2["files"] + r3["files"]), r2["files"] + r3["files"])
    chk("Export: Die Textfassung gibt es auch zur Tonspur", any(f.endswith("Nur Ton – Textfassung.txt") for f in r4["files"]) and any(f.endswith("Nur Ton.mp3") for f in r4["files"]), r4["files"])
    chk("Export: Die SRT-Datei enthält weiter nur die Untertitel", Path(next(f for f in r1["files"] if f.endswith(".srt"))).read_text(encoding="utf-8").count("-->") == 1)


def schrift_im_export():
    """2.28: Die gewählte Schrift steht im Video – so groß und so umbrochen wie in der Vorschau. Fehlt sie, sagt der Export es dazu.
    Sind die Untertitel eingebrannt, heißt die SRT-Datei anders als das Video."""
    import base64
    fdir = T.WEB_DIR / "fonts"
    pop, inter = T.FontFace((fdir / "Poppins-Bold.ttf").read_bytes()), T.FontFace((fdir / "Inter-Bold.ttf").read_bytes())
    chk("Schriftdatei: Familie, PostScript-Name und Schnitt werden gelesen", pop.family == "TS Poppins" and pop.ps == "TSPoppins-Regular" and pop.bold is False and pop.ok
        and T.font_names(fdir / "Anton-Regular.ttf") == ("TS Anton", False), [pop.family, pop.ps, pop.bold])
    chk("Höhenmaße: die Zelle, auf die libass die Größe bezieht, und Ober-/Unterlänge wie im Browser der Vorschau",
        abs(sum(pop.cell) - 1.762) < 0.002 and abs(pop.css[0] - 1.05) < 0.002 and abs(pop.css[1] - 0.35) < 0.002, [pop.cell, pop.css])
    chk("Laufweiten aus beiden Arten von Zeichentabellen (Format 4 und 12), auch für Umlaute und Sonderzeichen",
        pop._cmap[0] == 4 and inter._cmap[0] == 12 and all(0.15 < f.width(ch) < 1.3 for f in (pop, inter) for ch in "aWÄß€„“–")
        and abs(pop.width("Hamburg") - sum(pop.width(c) for c in "Hamburg")) < 1e-9 and pop.width("😀") == 1.0, [pop.width("W"), inter.width("W")])
    std = T.standard_face()
    chk("die Standardschrift (Arial fett) wird mit ihren Maßen gefunden", std is not None and std.ok and std.bold and abs(sum(std.cell) - 1.117) < 0.01, std and [std.family, std.cell])
    logs = []
    log0, T.log = T.log, logs.append
    try:
        dest = TMP / "schrift" / "fonts"
        fs = T.collect_fonts({"poppins": {"family": "TS Poppins", "file": "Poppins-Bold.ttf"}, "fehlt": {"family": "TS Gibtsnicht", "file": "Gibtsnicht.ttf"},
                              "weg": {"family": "Meine Schrift", "uri": str(TMP / "nirgends.ttf")}}, dest)
    finally:
        T.log = log0
    chk("mitgelieferte Schrift: Familienname aus der Datei, Kopie im Schriftordner des Exports, Maße liegen vor",
        fs["poppins"] == ("TS Poppins", False) and (dest / "poppins.ttf").read_bytes() == (fdir / "Poppins-Bold.ttf").read_bytes() and fs.face["poppins"].ps == "TSPoppins-Regular")
    chk("fehlende Schriftdateien werden mit ihrem Namen aus der Oberfläche gemeldet und stehen im Protokoll",
        fs.missing == ["Gibtsnicht", "Meine Schrift"] and "fehlt" not in fs and "weg" not in fs and sum("Datei fehlt" in x for x in logs) == 2, [fs.missing, logs])
    style = {"size": "mittel", "font": "poppins", "color": "#FFFFFF", "outline": True}
    lang = "Eine ziemlich lange Zeile die im Hochformat nicht mehr in die Breite passt"
    cues = T.clean_cues([{"start": 0, "end": 2, "text": "Kurz", "x": 0.5, "y": 0.88},
                         {"start": 2, "end": 4, "text": lang + "\nzweite Zeile", "x": 0.5, "y": 0.88},
                         {"start": 4, "end": 6, "text": "Mit Kasten", "x": 0.5, "y": 0.5, "bg": True},
                         {"start": 6, "end": 8, "text": "Standard bleibt Arial", "x": 0.5, "y": 0.5, "font": ""}])
    ass = TMP / "schrift.ass"
    T.write_ass(cues, style, ass, 1080, 1920, fs)
    txt = ass.read_text(encoding="utf-8-sig")
    ev = [ln for ln in txt.splitlines() if ln.startswith("Dialogue:")]
    px = 0.058 * 1080 * 1.25
    ypos = lambda ln: float(ln.split("\\pos(")[1].split(")")[0].split(",")[1])   # noqa: E731
    kurz = next(ln for ln in ev if ln.endswith("}Kurz"))
    chk("gewählte Schrift: Familienname aus der Datei, Größe auf das Geviert umgerechnet (Poppins: Zelle 1,762 Geviert)",
        f"\\fnTS Poppins\\b0\\fs{px * sum(pop.cell):.2f}" in kurz and "\\an5\\pos(540.0," in kurz, kurz[:150])
    rows = [ln for ln in ev if ",0:00:02.00,0:00:04.00," in ln]
    texts, ys = [ln.split("}", 1)[1] for ln in rows], [ypos(ln) for ln in rows]
    chk("zu lange Zeilen brechen bei 88 % der Breite um, jede Zeile passt ins Bild",
        len(texts) >= 4 and texts[-1] == "zweite Zeile" and " ".join(texts[:-1]) == lang and all(pop.width(r) * px <= 0.888 * 1080 for r in texts), texts)
    sh = ((pop.css[0] - pop.css[1]) - (pop.cell[0] - pop.cell[1])) / 2 * px    # Versatz der Grundlinie: Zelle (libass) gegen Zeile (Browser)
    chk("Zeilenabstand wie in der Vorschau (1,12 der Schriftgröße), der Block endet am Rand von 2 %",
        all(abs((b - a) - 1.12 * px) < 0.11 for a, b in zip(ys, ys[1:])) and abs(ys[-1] - sh + 0.56 * px - 1920 * 0.98) < 0.2, [ys, sh])
    box = [ln for ln in ev if ",0:00:04.00,0:00:06.00," in ln]
    chk("Kasten: eine eigene Fläche mit runden Ecken unter dem Text (60 % deckend)",
        len(box) == 2 and box[0].startswith("Dialogue: 0,") and "\\p4}m " in box[0] and " b " in box[0] and "\\1a&H66&" in box[0] and box[1].startswith("Dialogue: 1,") and box[1].endswith("}Mit Kasten"),
        [b[:130] for b in box])
    stdl = next(ln for ln in ev if ln.endswith("}Standard bleibt Arial"))
    chk("ein Untertitel mit eigener Standardschrift steht in Arial fett, ebenfalls auf das Geviert gerechnet", f"\\fnArial\\b1\\fs{px * sum(std.cell):.2f}" in stdl, stdl[:140])
    sec = txt.split("[Fonts]\n", 1)[1].split("\n\n[Events]", 1)[0].split("\n")
    data = "".join(sec[1:]).encode("ascii").translate(bytes.maketrans(bytes(range(33, 97)), b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"))
    chk("die gebrauchte Schrift steht zusätzlich in der Untertiteldatei selbst (Abschnitt [Fonts]), Zeilen zu 80 Zeichen",
        sec[0].startswith("fontname: ") and txt.count("fontname: ") == 1 and base64.b64decode(data + b"=" * (-len(data) % 4)) == (fdir / "Poppins-Bold.ttf").read_bytes()
        and max(len(x) for x in sec[1:]) == 80)
    T.write_ass(T.clean_cues([{"start": 0, "end": 2, "text": "Nur Standard", "x": 0.5, "y": 0.88}]), {"size": "mittel"}, ass, 1080, 1920, fs)
    chk("ohne gewählte Schrift wird keine Schriftdatei eingebettet", "[Fonts]" not in ass.read_text(encoding="utf-8-sig"))
    # Original und Übersetzung stehen gleichzeitig: Bricht eine Zeile um, rücken die Blöcke auseinander
    pair = T.clean_cues([{"start": 0, "end": 2, "text": lang + " und noch etwas länger wird", "x": 0.5, "y": 0.80},
                         {"start": 0, "end": 2, "text": "A rather long line that wraps in portrait format as well and goes on", "x": 0.5, "y": 0.86, "size": 0.045, "font": "poppins", "color": "#CFC6B0"}])
    T.write_ass(pair, style, ass, 1080, 1920, fs)
    ev = [ln for ln in ass.read_text(encoding="utf-8-sig").splitlines() if ln.startswith("Dialogue:")]
    px2 = 0.045 * 1080 * 1.25
    up, lo = [ypos(ln) for ln in ev if "\\1c&HFFFFFF&" in ln], [ypos(ln) for ln in ev if "\\1c&HB0C6CF&" in ln]
    chk("gleichzeitige Untertitel (Original und Übersetzung) überdecken einander nach dem Umbruch nicht und bleiben im Bild",
        len(up) >= 3 and len(lo) >= 2 and max(up) + 0.56 * px < min(lo) - 0.56 * px2 and max(lo) + 0.56 * px2 <= 1920 * 0.98 + 0.096 * px2 + 1, [up, lo])
    win = ("[Parsed_subtitles_0 @ 000002cf] Using font provider directwrite (with GDI)\n"
           "[Parsed_subtitles_0 @ 000002cf] fontselect: (TS Poppins, 400, 0) -> TSPoppins-Regular, 0, TSPoppins-Regular\n")
    lin = "[Parsed_subtitles_1 @ 0x55d] fontselect: (TS Poppins, 400, 0) -> /tmp/x/fonts/poppins.ttf, 0, TSPoppins-Regular\n"
    bad = "[Parsed_subtitles_0 @ 000002cf] fontselect: (TS Poppins, 400, 0) -> C:\\WINDOWS\\Fonts\\arial.ttf, 0, ArialMT\n"
    emoji = win + "[Parsed_subtitles_0 @ 000002cf] fontselect: (TS Poppins, 400, 0) -> C:\\WINDOWS\\Fonts\\seguiemj.ttf, 0, SegoeUIEmoji\n"
    chk("Nachprüfung am Protokoll von ffmpeg: libass hat die mitgegebene Datei genommen (Windows und Linux); der Ersatz für einzelne Zeichen zählt nicht",
        T.font_check(win, fs) == [] and T.font_check(lin, fs) == [] and T.font_check(emoji, fs) == [] and T.font_check("", fs) == [] and T.font_check(bad, {}) == [])
    chk("Nachprüfung: Nimmt libass eine andere Schrift, wird sie mit ihrem Namen aus der Oberfläche gemeldet", T.font_check(bad, fs) == ["Poppins"], T.font_check(bad, fs))
    # echte Exporte (kurze Probevideos)
    probe = T.font_selftest()
    chk("echter Export: Standardschrift und gewählte Schriften stehen im Video – so breit, wie die Vorschau sie zeigt (höchstens 8 % Abweichung)", probe["ok"], probe)
    video = TMP / "videos" / "schrift.mp4"
    video.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([T.FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x305070:size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2",
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video)], check=True, capture_output=True)

    def plan(name, font, fonts, burn=True, fmt="video"):
        return {"format": fmt, "name": name, "width": 640, "height": 360, "fps": 25, "total": 2, "audioFormat": "mp3",
                "segments": [{"kind": "main", "src": 0, "uri": str(video), "in": 0, "out": 2, "zooms": [], "hasAudio": True, "hasVideo": True, "speed": 1, "vol": 1,
                              "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1}],
                "overlays": [], "burn": burn, "quality": "klein",
                "subs": {"cues": [{"start": 0.1, "end": 1.9, "text": "Hamburgefonstiv 123", "x": 0.5, "y": 0.82}],
                         "style": {"size": "mittel", "color": "#FFFFFF", "outline": True, **({"font": font} if font else {})}, "fonts": fonts},
                "sources": [{"uri": str(video), "name": "schrift.mp4", "duration": 2, "width": 640, "height": 360, "fps": 25, "hasAudio": True, "hasVideo": True}]}
    names = lambda r: [Path(f).name for f in r["files"]]   # noqa: E731
    r1 = T.export_job(job(), plan("ohne_schrift", "fehlt", {"fehlt": {"family": "TS Gibtsnicht", "file": "Gibtsnicht.ttf"}}))
    chk("fehlt die Schriftdatei, steht die Standardschrift im Video – und der Export sagt es dazu",
        "„Gibtsnicht“" in (r1.get("warn") or "") and "Standardschrift" in r1["warn"] and "Fehlerbericht" in r1["warn"] and Path(r1["playable"]).stat().st_size > 2000, r1.get("warn"))
    r2 = T.export_job(job(), plan("mit_schrift", "poppins", {"poppins": {"family": "TS Poppins", "file": "Poppins-Bold.ttf"}}, burn=False))
    out = Path(r2["folder"])
    chk("ohne Einbrennen heißt die SRT-Datei wie das Video (Abspielprogramme blenden sie dann von selbst ein)", names(r2) == ["mit_schrift.mp4", "mit_schrift.srt"] and "warn" not in r2, names(r2))
    r3 = T.export_job(job(), plan("mit_schrift", "poppins", {"poppins": {"family": "TS Poppins", "file": "Poppins-Bold.ttf"}}))
    chk("eingebrannt: kein Hinweis, die SRT-Datei heißt anders als das Video, die gleichnamige vom früheren Export ist weg",
        "warn" not in r3 and names(r3) == ["mit_schrift.mp4", "Untertitel – mit_schrift.srt"] and not (out / "mit_schrift.srt").exists() and (out / "Untertitel – mit_schrift.srt").read_text(encoding="utf-8").count("-->") == 1,
        [names(r3), r3.get("warn"), sorted(p.name for p in out.iterdir())])
    r4 = T.export_job(job(), plan("mit_schrift", "poppins", {"poppins": {"family": "TS Poppins", "file": "Poppins-Bold.ttf"}}, burn=False))
    chk("wieder ohne Einbrennen: zurück zum Namen des Videos, die andere Datei weicht", names(r4) == ["mit_schrift.mp4", "mit_schrift.srt"] and not (out / "Untertitel – mit_schrift.srt").exists())
    r5 = T.export_job(job(), plan("nur_ton", "", {}, fmt="audio"))
    chk("zur Tonspur heißt die SRT-Datei wie die Tonspur", names(r5) == ["nur_ton.mp3", "nur_ton.srt"], names(r5))


def transkript():
    """Eigenes Wörterbuch (C1): Die Begriffe gehen als Hinweis an Whisper."""
    from types import SimpleNamespace as NS
    chk("Hinweis für Whisper: Leerraum bereinigt; leer heißt kein Hinweis", T.asr_hint("  Hermeier,\n  AfD ") == "Hermeier, AfD" and T.asr_hint("") is None and T.asr_hint(None) is None)
    chk("ein überlanger Hinweis wird gekürzt", len(T.asr_hint("Wort " * 400)) <= 600)

    class Neu:   # faster-whisper ab 1.0.2 kennt hotwords
        def __init__(self):
            self.calls = []

        def transcribe(self, audio, hotwords=None, **kw):
            self.calls.append({"hotwords": hotwords, **kw})
            seg = NS(end=1.0, words=[NS(word=" Hermeier", start=0.2, end=0.8, probability=0.91), NS(word=" ", start=0.8, end=0.9, probability=0.5)])
            return iter([seg]), NS(language="de")

    class Alt:   # ältere Fassung: Der Parameter fehlt
        def __init__(self):
            self.calls = []

        def transcribe(self, audio, language=None, word_timestamps=False):
            self.calls.append((language, word_timestamps))
            return iter(()), None

    m = Neu()
    T.whisper_run(m, [0.0], "Hermeier, AfD", language="de", word_timestamps=True)
    chk("der Hinweis geht als hotwords an Whisper", m.calls == [{"hotwords": "Hermeier, AfD", "language": "de", "word_timestamps": True}], m.calls)
    m = Neu()
    T.whisper_run(m, [0.0], None, language="de")
    chk("ohne Wörterbuch bleibt der Aufruf, wie er war", m.calls == [{"hotwords": None, "language": "de"}], m.calls)
    a = Alt()
    T.whisper_run(a, [0.0], "Hermeier", language="de", word_timestamps=True)
    chk("eine ältere Fassung von faster-whisper transkribiert ohne Hinweis weiter", a.calls == [("de", True)], a.calls)

    # der ganze Weg: transcribe_job mit nachgestelltem Modell
    wav = TMP / "ton.wav"
    subprocess.run([T.FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-ac", "1", "-ar", "16000", str(wav)], check=True)
    m, old = Neu(), T.get_model
    T.get_model = lambda name, phase, j: (m, "cpu")
    try:
        j = {"status": "running", "cancel": False, "progress": 0, "message": ""}
        res = T.transcribe_job(j, str(wav), "small", "de", True, None, " Hermeier,  AfD ")
        c = m.calls[0] if m.calls else {}
        chk("Transkription: Begriffe als hotwords, Füllwörter weiter als Startkontext", c.get("hotwords") == "Hermeier, AfD" and c.get("initial_prompt") == T.FILLER_PROMPT["de"] and c.get("condition_on_previous_text") is False, c)
        chk("das Ergebnis enthält die Wörter mit Zeiten und Sicherheit", res["words"] == [{"text": " Hermeier", "start": 0.2, "end": 0.8, "prob": 0.91}] and res["lang"] == "de" and bool(res["env"]), res["words"])
        res = T.transcribe_job(j, str(wav), "small", "de", True, None, "")
        chk("leeres Wörterbuch: kein Hinweis", m.calls[1].get("hotwords") is None, m.calls[1])
        res = T.transcribe_job(j, str(wav), "small", "de", False, [[0.2, 1.4]], "")
        chk("einzelne Stellen nachhören: ohne Hinweis, Zeiten auf die Datei bezogen", m.calls[2].get("hotwords") is None and res["ranges"][0]["words"][0]["text"] == "Hermeier" and abs(res["ranges"][0]["words"][0]["start"] - 0.25) < 0.01, res["ranges"])
        j["status"] = "done"
    finally:
        T.get_model = old


def umzug():
    a = json.loads((TMP / "umzug.json").read_text())
    mk(T.FONT_DIR / "Zweite.otf", b"ANDERE-SCHRIFT")      # gleicher Name, anderer Inhalt
    r = T.backup_restore_job(job(), ZIP)
    chk("anderer Rechner: alle Projekte, Bilder und Schriften kommen dazu", sorted(r["added"]) == ["Interview", "Kurzclip", "Rede zum Haushalt"] and r["slides"] == 3 and r["fonts"] == 2 and not r["failed"])
    p1 = proj("b1")
    f1n = T.norm_path(str(T.FONT_DIR / "Meine Schrift.ttf"))
    chk("Bildpfade zeigen in den neuen Datenordner, die Dateien liegen dort", p1["items"][0]["clip"]["uri"] == T.norm_path(str(D / "folien/b1/folie-a1-2.png"))
        and Path(p1["items"][0]["clip"]["uri"]).read_bytes() == b"\x89PNG-1" * 1000 and Path(p1["slides"][0]["img"]).is_file() and Path(p1["items"][1]["clip"]["uri"]).is_file())
    chk("Schriftschlüssel folgen dem neuen Speicherort", p1["sub_style"]["font"] == "u" + T._js_hash(f1n) != a["key1"] and p1["items"][0]["font"] == "u" + T._js_hash(f1n))
    chk("auch in den gesicherten Looks zeigt die Schrift auf den neuen Speicherort", r["prefs"]["hc-sub-looks"][0]["st"]["font"] == "u" + T._js_hash(f1n) and r["prefs"]["hc-fillers"] == ["halt", "ich sag mal"], r["prefs"].get("hc-sub-looks"))
    chk("Videopfade und Transkript bleiben, wie sie waren", p1["sources"][0]["uri"] == "/videos/rede.mp4" and p1["tokens"][0]["text"] == "u1abc" and proj("b2")["sources"][0]["orig"] == "/videos/interview.mp4")
    chk("vorhandene Schrift gleichen Namens bleibt, die gesicherte liegt daneben", (T.FONT_DIR / "Zweite.otf").read_bytes() == b"ANDERE-SCHRIFT" and (T.FONT_DIR / "Zweite_2.otf").read_bytes() == b"FONT-B" * 50)


def neue_versionen():
    hits = []
    state = {"fail": False}
    site = "https://github.com/honeybalecta/textschnitt/releases/"

    def rel(v, **kw):
        return {"tag_name": "v" + v, "html_url": f"{site}tag/v{v}", "published_at": "2026-12-01T10:00:00Z",
                "assets": [{"name": f"HoneyCut-Setup-{v}.exe", "browser_download_url": f"{site}download/v{v}/HoneyCut-Setup-{v}.exe", "size": 640000000}], **kw}
    releases = [{"tag_name": "android-v9.9.9", "assets": [{"name": "x.apk", "browser_download_url": site + "x.apk", "size": 5}]}, rel("2.99.0", draft=True),
                {"tag_name": "v2.98.0", "assets": []}, rel("2.28.0"), rel("2.27.0"), rel("2.25.0")]
    notes = ("# Neuigkeiten\n\nWas sich mit jeder Version ändert.\n\n## 2.29.0 · Noch nicht veröffentlicht\n- kommt später\n\n## 2.28.0 · Quellen und Belege\n"
             "- Quellen zu Aussagen hinterlegen\n- Bauchbinden im Hausstil\n\n## 2.27.0 – Kleine Helfer\n- Titelbild exportieren\n* Kapitelmarken\n\n## 2.25.0 · Grundüberholung\n- flüssigere Zeitleiste\n")

    def get(url, timeout=8.0):
        hits.append(url)
        if state["fail"]:
            raise OSError("nicht erreichbar")
        return (json.dumps(releases) if "releases" in url else notes).encode("utf-8")
    T._http_get = get
    chk("Versionen werden als Zahlen verglichen", T._ver("v2.26.0") == (2, 26, 0) and T._ver("2.26") == (2, 26, 0) and T._ver("android-v2.26.0") == () and T._ver("2.10.0") > T._ver("2.9.9"))
    real = T.VERSION
    T.VERSION = "2.26.0"
    st = T.update_state()
    chk("Ausgangslage: eingeschaltet, noch nichts bekannt", st["supported"] and st["enabled"] and st["latest"] is None and st["checked"] == 0)
    L = T.update_check()["latest"]
    chk("die neueste veröffentlichte Windows-Fassung wird gefunden (Entwurf, Android und Fassung ohne Installer zählen nicht)",
        bool(L) and L["version"] == "2.28.0" and L["installer"].endswith("HoneyCut-Setup-2.28.0.exe") and L["size"] == 640000000, L and L["version"])
    chk("Stichpunkte aller übersprungenen Versionen, neueste zuerst", [n["version"] for n in L["notes"]] == ["2.28.0", "2.27.0"] and L["notes"][0]["title"] == "Quellen und Belege"
        and L["notes"][0]["points"] == ["Quellen zu Aussagen hinterlegen", "Bauchbinden im Hausstil"] and L["notes"][1]["points"] == ["Titelbild exportieren", "Kapitelmarken"])
    chk("genau zwei Abfragen: Veröffentlichungen und Neuigkeiten", len(hits) == 2 and "releases" in hits[0] and hits[1].endswith("NEUIGKEITEN.md"), hits)
    T.update_check()
    chk("am selben Tag wird nicht noch einmal gefragt", len(hits) == 2)
    saved = json.loads(T.SETTINGS_PATH.read_text(encoding="utf-8"))
    chk("das Ergebnis bleibt über Neustarts erhalten", saved["updateLatest"]["version"] == "2.28.0" and saved["updateChecked"] > time.time() - 60)
    T.settings_set(updates=False, updateChecked=0)
    T.update_check()
    chk("abgeschaltet: keine Abfrage", len(hits) == 2 and T.update_state()["enabled"] is False)
    T.update_check(force=True)
    chk("„Jetzt prüfen“ fragt trotzdem nach", len(hits) == 4)
    T.VERSION = "2.28.0"
    chk("nach dem Installieren verschwindet der Hinweis", T.update_state()["latest"] is None)
    T.settings_set(updates=True, updateChecked=0)
    chk("aktuell: kein Hinweis", T.update_check()["latest"] is None)
    T.VERSION = "2.26.0"
    state["fail"] = True
    T.settings_set(updateChecked=0)
    try:
        T.update_check()
        chk("GitHub nicht erreichbar: Fehler für den Aufrufer", False)
    except OSError:
        chk("GitHub nicht erreichbar: Fehler für den Aufrufer, nichts wird als geprüft vermerkt", T.settings_get().get("updateChecked") == 0)
    state["fail"] = False
    T.update_check(force=True)
    opened = []
    T.webbrowser.open = lambda u, *a, **k: opened.append(u)
    T.update_open("installer")
    T.update_open("page")
    chk("Installer und Seite öffnen sich im Browser", opened == [site + "download/v2.28.0/HoneyCut-Setup-2.28.0.exe", site + "tag/v2.28.0"])
    T.settings_set(updateLatest={**T.settings_get()["updateLatest"], "installer": "https://boese.example/x.exe"})
    try:
        T.update_open("installer")
        chk("fremde Adresse wird nicht geöffnet", False)
    except ValueError:
        chk("fremde Adresse wird nicht geöffnet", len(opened) == 2)
    T.VERSION = real


def export_231():
    """2.31: Export über die Grafikkarte (Erkennung, Einstellungen, Rückfall), Beigaben eines Export-Pakets, Versionsstellen."""
    import base64
    # Kodier-Einstellungen
    for name, codec in (("nvenc", "h264_nvenc"), ("qsv", "h264_qsv"), ("amf", "h264_amf")):
        a = [T.gpu_vcodec(name, q) for q in ("hoch", "standard", "klein", None)]
        chk(f"Grafikkarte {name}: eigener Encoder, drei Qualitätsstufen, 4:2:0-Ausgabe", all(x[:2] == ["-c:v", codec] and "-pix_fmt" in x for x in a) and len({tuple(x) for x in a[:3]}) == 3 and a[1] == a[3], a[1])
    # Erkennung: ohne passende Hardware bleibt der bisherige Weg, einmal gesucht je Programmlauf
    run0, state0 = subprocess.run, dict(T.GPU)
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        from types import SimpleNamespace as NS
        if "-encoders" in cmd:
            return NS(returncode=0, stdout=" V....D h264_nvenc   NVIDIA\n V..... h264_qsv   Intel\n", stderr="")
        return NS(returncode=0 if "h264_qsv" in cmd else 1, stdout="", stderr="" if "h264_qsv" in cmd else "No capable devices found\n")
    try:
        T.GPU.update(state="new", enc=None, tried=[])
        subprocess.run = fake_run
        e1 = T.gpu_detect()
        n1 = len(calls)
        e2 = T.gpu_detect()
        chk("Erkennung: Der erste Encoder, der den Probelauf schafft, wird genommen (hier Intel nach gescheitertem Nvidia)",
            e1 == {"name": "qsv", "label": "Intel", "codec": "h264_qsv"} and n1 == 3 and T.GPU["tried"] == ["nvenc: No capable devices found"], [e1, T.GPU["tried"]])
        chk("gesucht wird einmal je Programmlauf", e2 == e1 and len(calls) == n1)
        chk("die Oberfläche bekommt Namen und Bezeichnung", T.gpu_info() == {"state": "ready", "name": "qsv", "label": "Intel"})
        T.GPU.update(state="new", enc=None, tried=[])
        subprocess.run = lambda cmd, **kw: (_ for _ in ()).throw(OSError("ffmpeg fehlt"))
        chk("scheitert schon die Abfrage, gibt es keine Grafikkarte und keinen Absturz", T.gpu_detect() is None and T.gpu_info()["name"] is None and T.gpu_info()["state"] == "ready")
    finally:
        subprocess.run = run0
        T.GPU.clear()
        T.GPU.update(state0)
    # echte Exporte: nachgestellte Grafikkarte, die klappt bzw. scheitert
    video = TMP / "videos" / "gpu.mp4"
    video.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([T.FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2",
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video)], check=True, capture_output=True)

    def plan(name, **kw):
        return {"format": "video", "name": name, "width": 640, "height": 360, "fps": 25, "total": 2, "quality": "klein", "burn": False, "overlays": [],
                "segments": [{"kind": "main", "src": 0, "uri": str(video), "in": 0, "out": 2, "zooms": [], "hasAudio": True, "hasVideo": True, "speed": 1, "vol": 1,
                              "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1}],
                "sources": [{"uri": str(video), "name": "gpu.mp4", "duration": 2, "width": 640, "height": 360, "fps": 25, "hasAudio": True, "hasVideo": True}], **kw}
    det0, vc0 = T.gpu_detect, T.gpu_vcodec
    seen = []
    try:
        T.gpu_detect = lambda: {"name": "nvenc", "label": "Nvidia", "codec": "h264_nvenc"}
        T.gpu_vcodec = lambda name, q: (seen.append((name, q)), ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p"])[1]
        r0 = T.export_job(job(), plan("ohne_gpu"))
        seen0 = list(seen)
        r1 = T.export_job(job(), plan("mit_gpu", gpu=True))
        chk("ohne den Schalter im Plan rechnet der bisherige Weg", "gpu" not in r0 and not seen0 and "Grafikkarte" not in r0["note"] and Path(r0["playable"]).stat().st_size > 2000, r0["note"])
        chk("mit dem Schalter rechnet die Grafikkarte, mit der Qualität aus dem Plan; das Ergebnis sagt es dazu", r1.get("gpu") == "Nvidia" and seen == [("nvenc", "klein")] and "über die Grafikkarte (Nvidia)" in r1["note"] and Path(r1["playable"]).stat().st_size > 2000, [r1.get("gpu"), seen, r1["note"]])
        T.gpu_vcodec = lambda name, q: ["-c:v", "h264_gibtsnicht"]
        j = job()
        r2 = T.export_job(j, plan("gpu_scheitert", gpu=True))
        d = float(subprocess.run([T.FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", r2["playable"]], capture_output=True, text=True).stdout or 0)
        chk("scheitert die Grafikkarte, rechnet der Export von selbst auf dem bisherigen Weg neu – das Video ist vollständig, das Ergebnis nennt den Rückfall",
            r2.get("gpuFallback") == "Nvidia" and "gpu" not in r2 and "bisherigen Weg" in r2["note"] and abs(d - 2) < 0.2, [r2.get("gpuFallback"), r2["note"], d])
        T.gpu_detect = lambda: None
        r3 = T.export_job(job(), plan("keine_gpu", gpu=True))
        chk("ohne nutzbare Grafikkarte bleibt der Schalter wirkungslos", "gpu" not in r3 and "gpuFallback" not in r3 and Path(r3["playable"]).exists())
        ra = T.export_job(job(), plan("nur_ton", gpu=True, format="audio", audioFormat="mp3"))
        chk("eine Tonspur geht nie über die Grafikkarte", "gpu" not in ra and ra["playable"].endswith(".mp3"))
        # Beigaben eines Export-Pakets
        img = base64.b64encode(b"\xff\xd8\xff" + b"x" * 500).decode()
        r4 = T.export_job(job(), plan("paket", extras=[{"name": "Mieten: Film – Titelbild.jpg", "data": img}, {"name": "../../böse.exe", "data": img}, {"name": "leer.png", "data": ""}, "kaputt"]))
        extra = [Path(f) for f in r4["files"] if f.endswith(".jpg")]
        folder = Path(r4["folder"])
        chk("Beigaben (Titelbild) liegen im Ordner des Exports und stehen in der Liste der Dateien",
            len(extra) == 1 and extra[0].name == "Mieten_ Film – Titelbild.jpg" and extra[0].parent == folder and extra[0].read_bytes()[:3] == b"\xff\xd8\xff", [Path(f).name for f in r4["files"]])
        chk("andere Dateiarten, leere und kaputte Beigaben bleiben draußen; nichts landet außerhalb des Ordners",
            not any(f.endswith((".exe", ".png")) for f in r4["files"]) and not list(folder.parent.glob("*.exe")) and not list(folder.parent.parent.glob("*.exe")), r4["files"])
    finally:
        T.gpu_detect, T.gpu_vcodec = det0, vc0
    # Versionsstellen: fünf Dateien, eine Version
    root = Path(T.__file__).resolve().parent
    vs = {"textschnitt.py": T.VERSION}
    for f in ("packaging/app-version.txt", "android/version.txt", "web/version.txt"):
        vs[f] = (root / f).read_text(encoding="utf-8").strip() if (root / f).exists() else "(fehlt)"
    pv = (root / "packaging" / "version.txt").read_text(encoding="utf-8") if (root / "packaging" / "version.txt").exists() else ""
    tup = "(" + ", ".join(T.VERSION.split(".")) + ", 0)"
    vs["packaging/version.txt"] = T.VERSION if pv.count(tup) == 2 and pv.count(f"'{T.VERSION}'") == 2 else "(weicht ab)"
    chk("alle fünf Versionsstellen nennen dieselbe Version im Muster x.y.z", re.fullmatch(r"\d+\.\d+\.\d+", T.VERSION) is not None and set(vs.values()) == {T.VERSION}, vs)
    news = (root / "NEUIGKEITEN.md").read_text(encoding="utf-8") if (root / "NEUIGKEITEN.md").exists() else ""
    chk("die Neuigkeiten haben einen Abschnitt für diese Version", f"## {T.VERSION} " in news, T.VERSION)


def untertitel_effekte():
    """2.32: Wort-Hervorhebung, Wort für Wort, betonte Wörter, Einblenden/Aufpoppen im Windows-Export (ASS)."""
    raw = [{"start": 1, "end": 3, "text": "Die Mieten steigen\nimmer weiter", "words": [[1, 1.4], [1.4, 1.9], [1.9, 2.3], [2.3, 2.6], [2.6, 3], [3, 4]],
            "hl": "#F5D90A", "build": True, "spans": [[1, "#E5402A"], [9, "#000000"], [2, "rot"], "kaputt"], "anim": "pop"},
           {"start": 4, "end": 5, "text": "ohne Effekte"},
           {"start": 6, "end": 7, "text": "nur Farbe hier", "spans": [[2, "#3E8A55"]], "words": [[6, 6.5]], "hl": "keine Farbe", "anim": "wackeln"},
           {"start": 8, "end": 9, "text": "blendet ein", "anim": "fade", "words": "kaputt", "hl": "#FFFFFF"}]
    cues = T.clean_cues(raw)
    a, b, c, d = cues
    chk("Plan: Wortzeiten, Farbe des gesprochenen Worts, Aufbau, betonte Wörter und Animation kommen an – auf die Wörter des Textes begrenzt",
        a["words"] == [[1.0, 1.4], [1.4, 1.9], [1.9, 2.3], [2.3, 2.6], [2.6, 3.0]] and a["hl"] == "#F5D90A" and a["build"] is True and a["spans"] == [[1, "#E5402A"]] and a["anim"] == "pop", a)
    chk("Plan: Untertitel ohne Effekte bleiben, wie sie waren; unbrauchbare Angaben fallen weg", not T.cue_has_fx(b) and "words" not in c and "hl" not in c and "anim" not in c and c["spans"] == [[2, "#3E8A55"]]
        and d.get("anim") == "fade" and "words" not in d and "hl" not in d, [b, c, d])
    chk("Stand je Wort: vor dem Sprechen verborgen, beim Sprechen hervorgehoben, betonte Wörter in ihrer Farbe",
        T.fx_state(a, 1.0, 5) == ["#F5D90A", "", "", "", ""] and T.fx_state(a, 1.5, 5) == [None, "#F5D90A", "", "", ""] and T.fx_state(a, 2.0, 5) == [None, "#E5402A", "#F5D90A", "", ""]
        and T.fx_state(a, 2.99, 5) == [None, "#E5402A", None, None, "#F5D90A"] and T.fx_state(c, 6.2, 3) == [None, None, "#3E8A55"], [T.fx_state(a, t, 5) for t in (1.0, 1.5, 2.0, 2.99)])
    sl = T.fx_slices(a)
    chk("Zeitabschnitte: einer je Wort, lückenlos über die ganze Dauer", sl == [(1.0, 1.4), (1.4, 1.9), (1.9, 2.3), (2.3, 2.6), (2.6, 3.0)], sl)
    quick = T.clean_cues([{"start": 1, "end": 2, "text": "a b c", "words": [[1, 1.05], [1.05, 1.1], [1.1, 2]], "hl": "#FFFFFF", "anim": "fade"}])[0]
    sq = T.fx_slices(quick)
    chk("Wechsel während der Animation rücken an ihr Ende: Einblenden und Aufpoppen laufen in einem Stück", sq[0] == (1.0, 1.0 + T.SUB_ANIM_S) and sq[-1][1] == 2.0 and all(y > x for x, y in sq) and all(p[1] == q[0] for p, q in zip(sq, sq[1:])), sq)
    chk("ohne Wortwechsel bleibt es bei einem Abschnitt", T.fx_slices(c) == [(6.0, 7.0)] and T.fx_slices(d) == [(8.0, 8.0 + T.SUB_ANIM_S), (8.0 + T.SUB_ANIM_S, 9.0)] or T.fx_slices(d) == [(8.0, 9.0)], [T.fx_slices(c), T.fx_slices(d)])
    ass = TMP / "effekte.ass"
    T.write_ass(cues, {"size": "mittel", "color": "#FFFFFF"}, ass, 1080, 1920, {})
    ev = [ln for ln in ass.read_text(encoding="utf-8-sig").splitlines() if ln.startswith("Dialogue:")]
    at = lambda t0: [ln for ln in ev if ln.startswith(f"Dialogue: 1,{t0},")]   # noqa: E731
    first, third = at("0:00:01.00"), at("0:00:01.90")
    chk("ASS: je Abschnitt zwei Zeilen an fester Lage; die Lage ändert sich über die Abschnitte nicht",
        len(first) == 2 and len(third) == 2 and re.search(r"\\pos\(([\d.]+),([\d.]+)\)", first[0]).groups() == re.search(r"\\pos\(([\d.]+),([\d.]+)\)", third[0]).groups(), [len(first), len(third)])
    chk("ASS: das gesprochene Wort trägt die Hervorhebung, spätere Wörter sind verborgen, das betonte Wort hat seine Farbe",
        first[0].endswith("{\\1c&H0AD9F5&}Die {\\alpha&HFF&}Mieten steigen") and first[1].endswith("{\\alpha&HFF&}immer weiter")
        and third[0].endswith("Die {\\1c&H2A40E5&}Mieten {\\1c&H0AD9F5&}steigen") and third[1].endswith("{\\alpha&HFF&}immer weiter"), [first[0][-60:], third[0][-70:]])
    last = at("0:00:02.60")
    chk("ASS: nach dem Sprechen steht ein Wort wieder in der Grundfarbe", last[1].endswith("immer {\\1c&H0AD9F5&}weiter") and last[0].endswith("Die {\\1c&H2A40E5&}Mieten {\\1c&HFFFFFF&}steigen"), [last[0][-60:], last[1][-40:]])
    chk("ASS: Aufpoppen nur im ersten Abschnitt, Einblenden als \\fad", "\\fscx84\\fscy84\\t(0,160,\\fscx100\\fscy100)" in first[0] and "\\fscx84" not in third[0] and any("\\fad(160,0)" in ln for ln in at("0:00:08.00")), first[0][:200])
    plain = at("0:00:04.00")
    chk("ASS: Untertitel ohne Effekte sind unverändert ein Eintrag je Zeile", len(plain) == 1 and plain[0].endswith("}ohne Effekte") and "\\alpha" not in plain[0] and plain[0].count("{") == 1, plain)
    chk("SRT: Effekte ändern nichts an den Untertiteln als Text", [x["text"] for x in T.spoken_cues(cues)] == ["Die Mieten steigen\nimmer weiter", "ohne Effekte", "nur Farbe hier", "blendet ein"])
    box = T.clean_cues([{"start": 1, "end": 2, "text": "mit Kasten", "bg": True, "words": [[1, 1.5], [1.5, 2]], "hl": "#F5D90A", "anim": "fade"}])
    T.write_ass(box, {"size": "mittel"}, ass, 1080, 1920, {})
    ev = [ln for ln in ass.read_text(encoding="utf-8-sig").splitlines() if ln.startswith("Dialogue:")]
    chk("ASS: der Kasten steht in jedem Abschnitt und blendet mit ein", len([ln for ln in ev if "\\p4" in ln]) == len(T.fx_slices(box[0])) and "\\fad(160,0)" in next(ln for ln in ev if "\\p4" in ln), len(ev))


def ton_234():
    """2.34: Verlauf für „Musik weicht der Sprache“ (auch über die Stückelung langer Exporte hinweg), Rechenkern und Vorarbeit für
    „Stimme aufbereiten“, Übergänge als Ebenen je Abschnitt – bildgenau abgelesen an takt.mp4 (siehe medien.py)."""
    import hashlib
    import wave
    import numpy as np
    sys.path.insert(0, str(HERE))
    import medien
    import takt_lesen
    vd = TMP / "videos"
    vd.mkdir(parents=True, exist_ok=True)
    medien.takt(vd)
    video = str(vd / "takt.mp4")
    sr = 48000
    musik = vd / "musik3k.wav"
    tone = (0.2 * np.sin(2 * np.pi * 3000 * np.arange(10 * sr) / sr) * 32767).astype("<i2")
    with wave.open(str(musik), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(np.repeat(tone[:, None], 2, axis=1).tobytes())

    def pcm(file, rate=sr):
        raw = subprocess.run([T.FFMPEG, "-v", "error", "-i", str(file), "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, dtype="<i2").astype(float) / 32768

    def band_db(x, a, b, lo, hi, rate=sr):   # Pegel eines Frequenzbands in einem Zeitfenster
        w = x[int(a * rate): int(b * rate)]
        sp = np.abs(np.fft.rfft(w * np.hanning(len(w)))) ** 2
        fr = np.fft.rfftfreq(len(w), 1 / rate)
        return 10 * np.log10(sp[(fr >= lo) & (fr <= hi)].sum() / len(w) ** 2 + 1e-15)

    def seg(a, b, **kw):
        return {"kind": "main", "src": 0, "uri": video, "in": a, "out": b, "zooms": [], "hasAudio": True, "hasVideo": True, "speed": 1, "vol": 1,
                "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1, **kw}

    def plan(name, segs, fmt="video", **kw):
        return {"format": fmt, "name": name, "width": 640, "height": 360, "fps": 30, "total": round(sum(s["out"] - s["in"] for s in segs), 3), "quality": "klein", "burn": False,
                "audioFormat": "wav", "overlays": [], "segments": segs,
                "sources": [{"uri": video, "name": "takt.mp4", "duration": 30, "width": 640, "height": 360, "fps": 30, "hasAudio": True, "hasVideo": True}], **kw}

    # ── Verlauf ──
    pts = T.clean_curve([[3, 0.2], [1, 1], ["x", 1], [1.25, 0.2], [3.8, 1.5], [0, 1], None])
    chk("Verlauf: nach Zeit geordnet, Unlesbares fällt weg, Werte bleiben zwischen 0 und 1", pts == [[0, 1], [1, 1], [1.25, 0.2], [3, 0.2], [3.8, 1]], pts)
    chk("Verlauf: dazwischen linear, davor und dahinter gilt der Randwert", abs(T.curve_at(pts, 1.125) - 0.6) < 1e-9 and T.curve_at(pts, -5) == 1 and T.curve_at(pts, 99) == 1 and T.curve_at([], 3) == 1)
    sh = T.shift_curve(pts, 1.125, 2.5)
    chk("Verlauf für ein Stück: beginnt und endet mit dem Wert an seinen Rändern, die Punkte dazwischen rücken mit",
        len(sh) == 4 and sh[0][0] == 0 and abs(sh[0][1] - 0.6) < 1e-9 and abs(sh[1][0] - 0.125) < 1e-9 and abs(sh[2][0] - 1.875) < 1e-9 and sh[3][0] == 2.5 and abs(sh[3][1] - 0.825) < 1e-9, sh)
    chk("ohne Verlauf bleibt die Lautstärke bei 1", T.gain_expr([]) == "1" and T.shift_curve([], 3, 2) == [])
    a0 = T.export_job(job(), plan("ton_ohne", [seg(0, 6)], "audio", overlays=[{"mode": "audio", "uri": str(musik), "in": 0, "out": 6, "at": 0, "track": 1, "vol": 1, "hasAudio": True}],
                                  duck=[[0, 1], [1, 1], [1.25, 0.2], [3, 0.2], [3.8, 1]]))
    a1 = T.export_job(job(), plan("ton_weicht", [seg(0, 6)], "audio", overlays=[{"mode": "audio", "uri": str(musik), "in": 0, "out": 6, "at": 0, "track": 1, "vol": 1, "hasAudio": True, "duck": True}],
                                  duck=[[0, 1], [1, 1], [1.25, 0.2], [3, 0.2], [3.8, 1]]))
    x0, x1 = pcm(a0["playable"]), pcm(a1["playable"])
    m = [band_db(x1, a, b, 2900, 3100) - band_db(x0, a, b, 2900, 3100) for a, b in ((0.2, 0.9), (1.5, 2.9), (4.2, 5.8))]
    chk("Export: Die Tonspur mit duck folgt dem Verlauf (−14 dB im abgesenkten Teil, davor und danach unverändert)", abs(m[0]) < 0.5 and abs(m[1] + 14) < 0.7 and abs(m[2]) < 0.5, [round(v, 2) for v in m])
    mid = band_db(x1, 3.3, 3.5, 2900, 3100) - band_db(x0, 3.3, 3.5, 2900, 3100)
    chk("Export: Im Anstieg liegt der Pegel dazwischen", -11 < mid < -3, round(mid, 2))
    chk("Export: Eine Tonspur ohne duck bleibt trotz Verlauf im Plan gleich laut", abs(band_db(x0, 1.5, 2.9, 2900, 3100) - band_db(x0, 4.2, 5.8, 2900, 3100)) < 0.3)
    low = [band_db(x1, a, b, 100, 2500) - band_db(x0, a, b, 100, 2500) for a, b in ((0.2, 0.9), (1.5, 2.9))]
    chk("Export: Der Ton der Hauptspur bleibt vom Verlauf unberührt", max(abs(v) for v in low) < 0.5, [round(v, 2) for v in low])

    # ── Stimme aufbereiten: Rechenkern ──
    rng = np.random.default_rng(7)
    n = 4 * sr
    t = np.arange(n) / sr
    noise = 0.01 * rng.standard_normal((n, 2))
    dsp = T.VoiceDsp(sr, 2)
    dsp.prime(noise[: 2 * sr])
    y = dsp.process(noise, [])
    red = 20 * np.log10(np.sqrt((y[sr:] ** 2).mean()) / np.sqrt((noise[sr:] ** 2).mean()))
    chk("Stimme: gleichmäßiges Rauschen wird um rund 10 dB leiser, die Länge bleibt", y.shape == noise.shape and -13 < red < -8, round(red, 2))
    hum = np.repeat((0.05 * np.sin(2 * np.pi * 50 * t))[:, None], 2, axis=1)
    dsp = T.VoiceDsp(sr, 2)
    yh = dsp.process(hum + noise, [])
    f50 = lambda v: band_db(v[:, 0], 1.0, 3.9, 40, 60)   # noqa: E731
    chk("Stimme: Brummen bei 50 Hz verschwindet weitgehend", f50(yh) - f50(hum + noise) < -15, round(f50(yh) - f50(hum + noise), 1))
    gate = (np.sin(2 * np.pi * 1.5 * t) > 0).astype(float)
    gate = np.convolve(gate, np.ones(480) / 480, mode="same")
    voice = np.repeat((0.2 * gate * sum(np.sin(2 * np.pi * 180 * h * t) / h for h in range(1, 20)))[:, None], 2, axis=1)
    dsp = T.VoiceDsp(sr, 2)
    dsp.prime((voice + noise)[: 2 * sr])
    yv = dsp.process(voice + noise, [])
    on = gate > 0.99
    keep = 20 * np.log10(np.sqrt((yv[on] ** 2).mean()) / np.sqrt(((voice + noise)[on] ** 2).mean()))
    chk("Stimme: Die Sprache selbst behält ihren Pegel (höchstens der feste Ausgleich von 1,5 dB kommt dazu)", -1.5 < keep < 2.5, round(keep, 2))
    z = T.VoiceDsp(sr, 2).process(np.zeros((sr, 2)), [])
    chk("Stimme: Stille bleibt Stille", z.shape == (sr, 2) and float(np.abs(z).max()) == 0.0)
    dsp = T.VoiceDsp(sr, 2)
    dsp.prime((voice + noise)[: 2 * sr])
    yl = dsp.process(voice + noise, [[0, 0.5], [4, 0.5]])
    lv = 20 * np.log10(np.sqrt((yl[on] ** 2).mean()) / np.sqrt((yv[on] ** 2).mean()))
    chk("Stimme: Der Pegelverlauf wirkt als Faktor (0,5 = −6 dB)", abs(lv + 6.02) < 0.4, round(lv, 2))
    chk("Pegelverlauf aus dem Plan: geordnet und auf 0,1 bis 4 begrenzt", T.clean_level([[2, 9], [0, 0.01], "x", [1, 1.5]]) == [[0, 0.1], [1, 1.5], [2, 4.0]])

    # ── Stimme aufbereiten: Vorarbeit und Export ──
    tmp = Path(tempfile.mkdtemp(prefix="honeycut-stimme-"))
    pv = plan("x", [seg(0, 2, voice={"k": "s0"}), seg(3, 5, voice={"k": "s0", "lvl": [[0, 2], [2, 2]]}), seg(6, 7), {**seg(8, 9, voice={"k": "s0"}), "hasAudio": False}])
    cnt = T.voice_prepare(job(), pv, tmp)
    files = [s.get("_voice") for s in pv["segments"]]
    lens = []
    for name in files[:2]:
        raw = (tmp / name).read_bytes()
        lens.append((len(raw) - 44) // 8)
    chk("Vorarbeit: je Abschnitt mit voice eine Tondatei in voller Länge; Abschnitte ohne voice oder ohne Ton bleiben, wie sie sind",
        cnt == 2 and files[2] is None and files[3] is None and lens == [2 * sr, 2 * sr], [cnt, files, lens])
    ya, yb = (np.frombuffer((tmp / name).read_bytes()[44:], dtype="<f4").reshape(-1, 2) for name in files[:2])
    ra, rb = np.sqrt((ya ** 2).mean()), np.sqrt((yb ** 2).mean())
    chk("Vorarbeit: Der Pegelverlauf des Abschnitts steckt in der Tondatei", 4.5 < 20 * np.log10(rb / ra) < 7.5, round(20 * np.log10(rb / ra), 2))
    T.voice_prepare(job(), plan("x", [seg(0, 2)]), tmp)
    inp, graph = T.build_graph(pv, False, None)
    chk("Filtergraph: Aufbereitete Abschnitte lesen ihre Tondatei, die übrigen den Ton der Aufnahme",
        sum(1 for a in inp if a in files[:2]) == 2 and inp.count("-i") == 6 and graph.count("atrim=start=") == 1, [inp.count("-i"), graph.count("atrim=start=")])
    shutil.rmtree(tmp, ignore_errors=True)
    v0 = T.export_job(job(), plan("stimme_ohne", [seg(0, 2), seg(3, 5)], "audio"))
    v1 = T.export_job(job(), plan("stimme_mit", [seg(0, 2, voice={"k": "s0"}), seg(3, 5, voice={"k": "s0"})], "audio"))
    p0, p1 = pcm(v0["playable"]), pcm(v1["playable"])
    chk("Export mit aufbereiteter Stimme: gleiche Länge, der Ton ist bearbeitet", len(p0) == len(p1) == 4 * sr and float(np.abs(p0 - p1).max()) > 0.01, [len(p0), len(p1)])

    # ── Übergänge ──
    segs3 = lambda: [seg(0, 2), seg(3, 5), seg(6, 8)]   # noqa: E731
    lay = lambda a, b: {**seg(a, b), "hasAudio": False, "vol": 0}   # noqa: E731
    tr3 = [{"at": 1.6, "d": 0.4, "a0": 0, "a1": 1, "lead": 0, "tail": 0.1, "over": 0, "seg": lay(2.6, 3.1)},      # Blende vor dem ersten Schnitt
           {"at": 4.0, "d": 0.5, "a0": 1, "a1": 1, "lead": 0.1, "tail": 0, "over": 2, "seg": lay(4.9, 5.5)}]     # Bild später am zweiten Schnitt
    pt = plan("x", segs3(), trans=tr3 + [{"at": 1, "d": 0.5, "over": 9, "seg": lay(0, 1)}, {"at": 1, "d": 0.01, "over": 1, "seg": lay(0, 1)}, {"at": 1, "d": 0.5, "over": 1}, "x"])
    T.trans_prepare(pt)
    got = [[(round(q["off"], 3), q["d"]) for q in s.get("_trans", [])] for s in pt["segments"]]
    chk("Übergänge hängen an dem Abschnitt, über dem sie liegen, mit ihrem Beginn im Abschnitt; Unbrauchbares fällt weg", got == [[(1.6, 0.4)], [], [(0.0, 0.5)]], got)
    pt2 = plan("x", segs3(), trans=[{**tr3[1], "at": 4.004}])
    T.trans_prepare(pt2)
    chk("Beginnt eine Ebene auf Millisekunden am Schnitt, gilt sie vom ersten Bild des Abschnitts an", pt2["segments"][2]["_trans"][0]["off"] == 0.0)
    inp, graph = T.build_graph(pt, True, None)
    chk("Filtergraph: je Ebene eine eigene Eingabe und ein Auflegen vor dem Aneinanderhängen",
        inp.count("-i") == 5 and graph.count("eof_action=pass") == 2 and graph.count("settb=AVTB") == 2 and "concat=n=3" in graph, inp.count("-i"))
    inp, graph = T.build_graph(pt, False, None)
    chk("Nur Ton: Übergänge spielen keine Rolle", inp.count("-i") == 3 and "overlay" not in graph, inp.count("-i"))

    def frames(file):
        return takt_lesen.lesen(str(file))["frames"]

    def audio_md5(file):
        return hashlib.md5(subprocess.run([T.FFMPEG, "-v", "error", "-i", str(file), "-vn", "-f", "s16le", "-"], capture_output=True, check=True).stdout).hexdigest()

    def alpha(v, a, b):   # Anteil des Bilds b in einer Mischung mit dem Bild a (Balken, in denen sich beide unterscheiden)
        est = [(v[k] - ((a >> k) & 1)) / (((b >> k) & 1) - ((a >> k) & 1)) for k in range(10) if ((a >> k) & 1) != ((b >> k) & 1)]
        return sum(est) / len(est)
    h3 = T.export_job(job(), plan("takt_hart", segs3()))
    e3 = T.export_job(job(), plan("takt_weich", segs3(), trans=tr3))
    fh, fe = frames(h3["playable"]), frames(e3["playable"])
    want_h = list(range(0, 60)) + list(range(90, 150)) + list(range(180, 240))
    chk("ohne Übergänge: harte Schnitte, jedes Bild an seiner Stelle", [f[1] for f in fh] == want_h, len(fh))
    chk("mit Übergängen bleibt das Video gleich lang, der Ton gleich", len(fe) == len(fh) == 180 and audio_md5(e3["playable"]) == audio_md5(h3["playable"]), [len(fe), len(fh)])
    # Blende 0,4 s vor dem Schnitt bei 2,0 s: Ebene ab Bild 48 (Material ab Bild 78), Deckkraft j/12
    al = [alpha(fe[i][2], i, 78 + i - 48) for i in range(48, 60)]
    chk("Blende: Die Deckkraft steigt gleichmäßig von 0 auf 1 und ist am Schnitt fertig", all(abs(al[j] - j / 12) < 0.06 for j in range(12)), [round(v, 2) for v in al])
    chk("Blende: davor das Bild des vorigen Clips, danach nahtlos der nächste", [f[1] for f in fe[40:48]] == list(range(40, 48)) and [f[1] for f in fe[60:70]] == list(range(90, 100)))
    # „Bild später“ 0,5 s am Schnitt bei 4,0 s: der vorige Clip läuft 15 Bilder weiter (150–164), dann der nächste ab seinem 16. Bild
    chk("Bild später: Der vorige Clip läuft im Bild weiter, dann steigt der nächste an der richtigen Stelle ein",
        [f[1] for f in fe[110:140]] == list(range(140, 165)) + list(range(195, 200)), [f[1] for f in fe[116:140]])
    # lange Exporte in Stücken: acht Abschnitte zu je 0,5 s (15 Bilder), Schnitt k bei 0,5·k s; das erste Stück endet nach Abschnitt 5
    segs8 = [seg(m, m + 0.5) for m in range(8)]
    tr8 = [{"at": 0.5, "d": 0.2, "a0": 1, "a1": 0, "lead": 0.1, "tail": 0, "over": 1, "seg": lay(0.4, 0.7)},      # Blende hinter dem ersten Schnitt
           {"at": 2.8, "d": 0.2, "a0": 1, "a1": 1, "lead": 0, "tail": 0.1, "over": 5, "seg": lay(5.8, 6.1)},     # Bild früher am Schnitt zwischen den Stücken
           {"at": 3.5, "d": 0.2, "a0": 1, "a1": 1, "lead": 0.1, "tail": 0, "over": 7, "seg": lay(6.4, 6.7)}]     # Bild später im zweiten Stück
    mus = [{"mode": "audio", "uri": str(musik), "in": 0, "out": 4, "at": 0, "track": 1, "vol": 1, "hasAudio": True, "duck": True}]
    h8 = T.export_job(job(), plan("takt8_hart", segs8, overlays=mus))
    e8 = T.export_job(job(), plan("takt8_weich", [seg(m, m + 0.5) for m in range(8)], overlays=mus, trans=tr8, duck=[[0, 1], [2.9, 1], [3.1, 0.2], [9, 0.2]]))
    f8 = frames(e8["playable"])
    n8 = [f[1] for f in f8]
    chk("Stückelung: gleiche Länge wie ohne Übergänge", len(f8) == len(frames(h8["playable"])) == 120, len(f8))
    chk("Stückelung: Bild früher am Schnitt zwischen zwei Stücken (sechs Bilder des nächsten Clips, dann nahtlos weiter)", n8[78:96] == list(range(153, 159)) + list(range(174, 186)), n8[78:96])
    chk("Stückelung: Bild später im zweiten Stück", n8[99:114] == list(range(189, 201)) + list(range(216, 219)), n8[99:114])
    al8 = [alpha(f8[i][2], 30 + i - 15, 15 + i - 15) for i in range(15, 21)]
    chk("Stückelung: Blende hinter dem Schnitt läuft von 1 auf 0", all(abs(al8[j] - (1 - j / 6)) < 0.06 for j in range(6)) and n8[21:30] == list(range(36, 45)), [round(v, 2) for v in al8])
    y8, y8h = pcm(e8["playable"]), pcm(h8["playable"])
    d8 = [band_db(y8, a, b, 2900, 3100) - band_db(y8h, a, b, 2900, 3100) for a, b in ((0.3, 2.7), (3.3, 3.9))]
    chk("Stückelung: Der Verlauf für „Musik weicht der Sprache“ gilt über die Stücke hinweg", abs(d8[0]) < 0.6 and abs(d8[1] + 14) < 0.8, [round(v, 2) for v in d8])
    # die Probe, die auch der Selbsttest der gebauten Windows-App fährt
    st = T.ton_selftest()
    chk("Selbsttest der App: Absenkung, aufbereitete Stimme und Übergang im fertigen Video nachgemessen", st.get("ok") is True, st)


def belege_235():
    """2.35: unkenntlich gemachte Bereiche (plan["blurs"]) im Export – am Schachbrett-Muster ausgemessen: Rechteck verpixelt, Ellipse
    weichgezeichnet mit Keyframes, Lage am Bildrand, Reihenfolge (Einblendungen darunter, Formen und Fortschrittsbalken darüber),
    Stückelung langer Exporte, CapCut und Concat. Dieselben Erwartungen wie im Browser-Export (p_browser.mjs)."""
    import numpy as np
    vd = TMP / "belege"
    vd.mkdir(parents=True, exist_ok=True)
    W, H, FPS = 640, 360, 30

    def ff(*a):
        subprocess.run([T.FFMPEG, "-v", "error", "-y", *a], check=True, capture_output=True)
    video = vd / "karo.mp4"   # Schachbrett aus 4 Pixel großen Feldern, 6 s
    ff("-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={FPS}:d=6,format=gray,geq=lum='16+219*mod(floor(X/4)+floor(Y/4)\\,2)'", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "10", "-g", "15", str(video))
    for name, col, size in (("rot", "red", "32x32"), ("gruen", "lime", "32x32"), ("balken", "0xE5402A", "640x4"), ("weiss", "white", "64x64")):
        ff("-f", "lavfi", "-i", f"color=c={col}:s={size}", "-frames:v", "1", str(vd / f"{name}.png"))
    ff("-f", "lavfi", "-i", "color=c=black:s=128x128,format=gray,geq=lum='255*lte(pow((X+0.5-64)/64\\,2)+pow((Y+0.5-64)/64\\,2)\\,1)'", "-frames:v", "1", str(vd / "ellipse.png"))
    uri = lambda n: str(vd / f"{n}.png")

    def seg(a, b, **kw):
        return {"kind": "main", "src": 0, "uri": str(video), "in": a, "out": b, "zooms": [], "hasAudio": False, "hasVideo": True, "speed": 1, "vol": 1,
                "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1, **kw}

    def plan(name, segs=None, fmt="video", **kw):
        segs = segs or [seg(0, 2)]
        return {"format": fmt, "name": name, "width": W, "height": H, "fps": FPS, "total": round(sum(s["out"] - s["in"] for s in segs), 3), "quality": "hoch", "burn": False,
                "audioFormat": "wav", "overlays": [], "segments": segs,
                "sources": [{"uri": str(video), "name": "karo.mp4", "duration": 6, "width": W, "height": H, "fps": FPS, "hasAudio": False, "hasVideo": True}], **kw}

    def gray(file):   # alle Bilder als Graustufen
        raw = subprocess.run([T.FFMPEG, "-v", "error", "-i", str(file), "-an", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(int)

    def rgb(file, n):   # ein Bild in Farbe
        raw = subprocess.run([T.FFMPEG, "-v", "error", "-i", str(file), "-an", "-vf", f"select=eq(n\\,{n})", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(int)

    def box(g):   # Rahmen um alles, was nicht mehr Schachbrett ist (Mittelwerte); einzelne Ausreißer der Kompression zählen nicht
        m = (g > 70) & (g < 180)
        xs, ys = np.nonzero(m.sum(axis=0) >= 3)[0], np.nonzero(m.sum(axis=1) >= 3)[0]
        return [int(xs[0]), int(ys[0]), int(xs[-1]), int(ys[-1]), int(m.sum())] if len(xs) and len(ys) else None

    def near(b, want, tol=2):
        return b is not None and all(abs(b[i] - want[i]) <= tol for i in range(4))
    rect = {"at": 0.5, "d": 1, "x": 0.25, "y": 0.5, "w": 0.2, "wmax": 0.2, "aspect": 1, "form": "rect", "kind": "pixel", "cell": 0.025}
    ell = {"at": 0.5, "d": 1, "x": 0.7, "y": 0.5, "w": 0.1, "wmax": 0.2, "aspect": 1, "form": "ellipse", "kind": "soft", "cell": 0.025, "mask": uri("ellipse"),
           "kf": [{"t": 0, "x": 0.7, "y": 0.5, "w": 0.1}, {"t": 1, "x": 0.8, "y": 0.5, "w": 0.2}]}

    # ── Filtergraph ──
    inp, graph = T.build_graph(plan("g1", blurs=[rect]), True, None)
    chk("Filtergraph: Ein festes Rechteck braucht keine Maske – ausschneiden, auf 8 × 8 Felder mitteln, hart vergrößern, zurücklegen",
        inp.count("-i") == 1 and "crop=128:128" in graph and "scale=8:8:flags=area" in graph and "flags=neighbor" in graph and "alphamerge" not in graph and "enable='between(t,0.5000,1.5000)'" in graph)
    inp, graph = T.build_graph(plan("g2", blurs=[ell]), True, None)
    chk("Filtergraph: Die Ellipse mit Keyframes bekommt ihre Maske als eigene Eingabe, weich vergrößert", inp.count("-i") == 2 and "alphamerge" in graph and "flags=bilinear" in graph and "eval=frame" in graph)
    inp, graph = T.build_graph(plan("g3", blurs=[{**ell, "mask": str(vd / "fehlt.png")}]), True, None)
    chk("Filtergraph: Fehlt die Maskendatei, wird das ganze Fenster unkenntlich (lieber mehr als weniger)", inp.count("-i") == 1 and "alphamerge" not in graph and "crop=128:128" in graph)
    img = lambda u, x, y, w, **kw: {"mode": "pip", "image": True, "uri": uri(u), "at": 0, "in": 0, "out": 2, "x": x, "y": y, "w": w, "aspect": 1, "track": 5, "vol": 0,
                                    "hasAudio": False, "width": 32, "height": 32, "rotation": 0, **kw}
    ovs = [img("gruen", 0.2, 0.5, 0.04), img("rot", 0.25, 0.5, 0.05, track=100, top=True),
           img("balken", 0.5, 358 / 360, 1, aspect=160, track=150, top=True, opacity=0.35, width=640, height=4),
           img("balken", 0.5, 358 / 360, 1, aspect=160, track=151, top=True, width=640, height=4, kf=[{"t": 0, "x": -0.5, "y": 358 / 360, "w": 1}, {"t": 2, "x": 0.5, "y": 358 / 360, "w": 1}])]
    inp, graph = T.build_graph(plan("g4", blurs=[rect], overlays=ovs), True, None)
    pos = [graph.find("[o0]overlay"), graph.find("split[bva0]"), graph.find("[o1]overlay")]
    chk("Filtergraph: Einblendungen darunter, dann die Bereiche, dann Formen und Fortschrittsbalken (top)", -1 < pos[0] < pos[1] < pos[2], pos)
    inp, graph = T.build_graph(plan("g5", blurs=[rect], overlays=ovs[:1]), True, None)
    chk("Filtergraph: Ohne Formen kommen die Bereiche am Ende der Bildkette", -1 < graph.find("[o0]overlay") < graph.find("split[bva0]"))
    inp, graph = T.build_graph(plan("g6", blurs=[rect]), False, None)
    chk("Nur Ton: Bereiche spielen keine Rolle", "crop" not in graph and "split" not in graph)

    # ── gemessen am fertigen Video ──
    g0 = gray(T.export_job(job(), plan("belege_ohne"))["playable"])
    chk("Schachbrett ohne Bereiche: 60 Bilder, nichts gemittelt", len(g0) == 60 and box(g0[30]) is None, [len(g0), box(g0[30])])
    g1 = gray(T.export_job(job(), plan("belege_rechteck", blurs=[rect]))["playable"])
    b = box(g1[30])
    chk("verpixeltes Rechteck: genau der Bereich [96, 224) × [116, 244) ist betroffen, davor und danach nichts",
        near(b, [96, 116, 223, 243], 1) and abs(b[4] - 128 * 128) < 500 and box(g1[6]) is None and box(g1[51]) is None, [b, box(g1[6]), box(g1[51])])
    inner = g1[30][120:240, 100:220]
    chk("verpixeltes Rechteck: Die Felder mitteln das Schachbrett zu gleichmäßigem Grau, ohne Farbstich", 118 <= inner.mean() <= 134 and inner.max() - inner.min() <= 16, [round(float(inner.mean()), 1), int(inner.min()), int(inner.max())])
    c1 = rgb(T.export_job(job(), plan("belege_rechteck", blurs=[rect]))["playable"], 30)[150:210, 130:190].reshape(-1, 3).mean(axis=0)
    chk("verpixeltes Rechteck: Rot, Grün und Blau bleiben gleich (neutrales Grau)", max(c1) - min(c1) < 4, [round(float(v), 1) for v in c1])
    g2 = gray(T.export_job(job(), plan("belege_ellipse", blurs=[ell]))["playable"])
    e0, e1 = box(g2[15]), box(g2[30])
    chk("weichgezeichnete Ellipse mit Keyframes: Lage und Größe folgen dem Verlauf", near(e0, [416, 148, 479, 211], 3) and near(e1, [432, 132, 527, 227], 3), [e0, e1])
    chk("Ellipse: Fläche passt zur Ellipse (π/4 des Rahmens), die Ecken ihres Rahmens bleiben Schachbrett",
        e1 is not None and abs(e1[4] / (96 * 96) - np.pi / 4) < 0.05 and box(g2[30][132:142, 432:442]) is None and box(g2[30][218:228, 518:528]) is None, e1 and round(e1[4] / (96 * 96), 3))
    chk("Ellipse: vor ihrem Beginn und nach ihrem Ende ist das Bild unberührt", box(g2[10]) is None and box(g2[50]) is None, [box(g2[10]), box(g2[50])])
    g3 = gray(T.export_job(job(), plan("belege_rand", blurs=[{**rect, "x": 0.02, "y": 0.95, "mask": uri("weiss")}]))["playable"])
    chk("Bereich am Bildrand (mit Maske): nur der sichtbare Teil ist betroffen", near(box(g3[30]), [0, 278, 76, 359], 2), box(g3[30]))
    g3b = gray(T.export_job(job(), plan("belege_rand_ohne", blurs=[{**rect, "x": 0.02, "y": 0.95}]))["playable"])
    chk("Bereich am Bildrand ohne Maske: das ganze Fenster wird unkenntlich", near(box(g3b[30]), [0, 232, 127, 359], 2), box(g3b[30]))

    # ── Reihenfolge ──
    f4 = T.export_job(job(), plan("belege_folge", blurs=[rect], overlays=ovs))["playable"]
    c4 = rgb(f4, 30)
    rot, a, bb, cc = c4[178:184, 157:163].reshape(-1, 3).mean(axis=0), c4[181, 129], c4[190, 140], c4[181, 142]
    chk("Form über dem Bereich bleibt scharf (Rot in der Mitte)", rot[0] > 225 and rot[1] < 40 and rot[2] < 40, [int(v) for v in rot])
    chk("Einblendung unter dem Bereich wird mit verpixelt: Mischfarbe, im ganzen Feld gleich",
        a[1] > a[0] + 40 and a[0] > 10 and a[1] < 245 and max(abs(a - bb).max(), abs(a - cc).max()) <= 14, [a.tolist(), bb.tolist(), cc.tolist()])
    bal, grund, ueber = c4[357:359, 100:300].reshape(-1, 3).mean(axis=0), c4[357:359, 420:600].reshape(-1, 3).mean(axis=0), c4[346:352, 420:600]
    chk("Fortschrittsbalken: zur Hälfte der Zeit ist die linke Bildhälfte gefüllt, rechts liegt die Grundlinie über dem Bild",
        abs(bal[0] - 229) < 14 and abs(bal[1] - 64) < 16 and abs(bal[2] - 42) < 16 and grund[0] > grund[2] + 15 and abs(grund[0] - 229) > 20 and ueber.max() - ueber.min() > 150,
        [[int(v) for v in bal], [int(v) for v in grund]])
    kante = np.nonzero((c4[358, :, 0] > 200) & (c4[358, :, 1] < 110) & (c4[358, :, 2] < 90))[0]
    chk("Fortschrittsbalken: Seine Kante steht in der Bildmitte", len(kante) > 0 and abs(int(kante[-1]) - 319) <= 3, int(kante[-1]) if len(kante) else None)
    c5 = rgb(T.export_job(job(), plan("belege_weich", blurs=[{**rect, "kind": "soft"}], overlays=ovs))["playable"], 30)
    chk("weichgezeichnet: dieselbe Stelle verläuft, die Form darüber bleibt scharf",
        c5[178:184, 157:163, 0].mean() > 225 and c5[178:184, 157:163, 1].mean() < 40 and abs(c5[181, 129] - c5[181, 142]).max() > 20, [c5[181, 129].tolist(), c5[181, 142].tolist()])

    # ── Stückelung: acht Abschnitte zu je 0,5 s, das erste Stück endet bei 3,0 s ──
    segs8 = [seg(m * 0.5, m * 0.5 + 0.5) for m in range(8)]
    wander = {"at": 2.5, "d": 1, "x": 0.3, "y": 0.5, "w": 0.1, "wmax": 0.1, "aspect": 1, "form": "rect", "kind": "pixel", "cell": 0.025,
              "kf": [{"t": 0, "x": 0.3, "y": 0.5, "w": 0.1}, {"t": 1, "x": 0.7, "y": 0.5, "w": 0.1}]}
    lauf = img("balken", 0.5, 358 / 360, 1, aspect=160, track=151, top=True, width=640, height=4, out=4, kf=[{"t": 0, "x": -0.5, "y": 358 / 360, "w": 1}, {"t": 4, "x": 0.5, "y": 358 / 360, "w": 1}])
    sub = T.shift_plan(plan("teil", segs8, blurs=[wander], overlays=[lauf]), segs8[6:], 3.0, 1.0)
    chk("Stückelung: Der Bereich wird wie eine Einblendung zugeschnitten, seine Keyframes rücken mit",
        len(sub["blurs"]) == 1 and sub["blurs"][0]["at"] == 0 and abs(sub["blurs"][0]["d"] - 0.5) < 1e-9 and [round(k["t"], 3) for k in sub["blurs"][0]["kf"]] == [-0.5, 0.5]
        and len(T.shift_plan(plan("teil", segs8, blurs=[wander]), segs8[:2], 0.0, 1.0)["blurs"]) == 0, sub["blurs"])
    f8 = T.export_job(job(), plan("belege_stuecke", segs8, blurs=[wander], overlays=[lauf]))["playable"]
    g8 = gray(f8)
    b87, b93 = box(g8[87][:340]), box(g8[93][:340])
    chk("Stückelung: 120 Bilder; der Bereich wandert über die Grenze der Stücke hinweg gleichmäßig weiter",
        len(g8) == 120 and near(b87, [262, 148, 325, 211], 2) and near(b93, [312, 148, 375, 211], 2) and box(g8[70][:340]) is None and box(g8[110][:340]) is None, [len(g8), b87, b93])
    k8 = []
    for n in (87, 93):
        row = rgb(f8, n)[358]
        hit = np.nonzero((row[:, 0] > 200) & (row[:, 1] < 110) & (row[:, 2] < 90))[0]
        k8.append(int(hit[-1]) if len(hit) else None)
    chk("Stückelung: Der Fortschrittsbalken läuft über die Grenze der Stücke hinweg weiter", k8[0] is not None and k8[1] is not None and abs(k8[0] - 463) <= 4 and abs(k8[1] - 495) <= 4, k8)

    # ── CapCut und Concat: Formen gehen als Bilder mit, Bereiche bleiben dem Video-Export vorbehalten ──
    T.capcut_drafts_dir = lambda: None
    cc = T.export_job(job(), plan("belege_capcut", fmt="capcut", blurs=[rect], overlays=ovs[:2]))
    doc = json.loads(next(Path(f) for f in cc["files"] if Path(f).is_dir()).joinpath("draft_content.json").read_text(encoding="utf-8")) if cc.get("files") else {}
    names = [t.get("name") for t in doc.get("tracks", []) if t.get("type") == "video"]
    chk("CapCut: Die Form liegt als Bild auf einer eigenen Spur „Formen 1“ über den übrigen Spuren", names[-1:] == ["Formen 1"] and "Video 6" in names, names)
    try:
        cz = T.export_job(job(), plan("belege_concat", fmt="concat", blurs=[rect], overlays=ovs[:2]))
        okc = bool(cz.get("files"))
    except Exception as e:   # noqa: BLE001
        okc, cz = False, {"fehler": str(e)[:200]}
    chk("Concat: Der Export läuft mit Formen und Bereichen im Plan durch", okc, cz.get("fehler", ""))
    # die Probe, die auch der Selbsttest der gebauten Windows-App fährt
    st = T.belege_selftest()
    chk("Selbsttest der App: Rechteck, Ellipse und Form im fertigen Video nachgemessen", st.get("ok") is True, st)
    # Speicher verwalten: frühere Bilder markierter Screenshots und früherer Schritte lassen sich freigeben; was ein Projekt verwendet, bleibt
    fo = D / "folien" / "pb"
    for name in ("markiert-alt.png", "markiert-neu.png", "folie-b1-1-s1.png", "folie-b1-2-s1.png", "folie-b1-2.png", "form-abc.png", "balken-ffe14d-640x6.png", "maske-ellipse-205x256.png"):
        mk(fo / name, b"x" * 4000)
    pb = {"id": "pb", "name": "Belege", "sources": [], "items": [{"type": "broll", "clip": {"uri": str(fo / "markiert-neu.png")}, "mark": {"orig": {"uri": str(vd / "weiss.png")}}},
                                                               {"type": "broll", "slide": "b1", "clip": {"uri": str(fo / "folie-b1-2.png")}, "build": [{"t": 0, "clip": {"uri": str(fo / "folie-b1-2-s1.png")}}, {"t": 2, "clip": {"uri": str(fo / "folie-b1-2.png")}}]}]}
    mk(T.PROJ_DIR / "pb.json", json.dumps(pb))
    T.storage_clear("slides")
    left = sorted(x.name for x in fo.glob("*.png"))
    chk("Speicher verwalten: Frühere markierte Bilder und frühere Schritt-Bilder werden freigegeben; benutzte Bilder, Formen, Balken und Masken bleiben",
        left == ["balken-ffe14d-640x6.png", "folie-b1-2-s1.png", "folie-b1-2.png", "form-abc.png", "markiert-neu.png", "maske-ellipse-205x256.png"], left)
    (T.PROJ_DIR / "pb.json").unlink()


def bericht_und_protokoll():
    logged = []
    T.log = lambda msg: logged.append(msg)
    with open(T.LOG_PATH, "ab") as f:
        f.write(("x" * 99 + "\n").encode() * 60000)
    before = T.LOG_PATH.stat().st_size
    cut = T.trim_log()
    after = T.LOG_PATH.stat().st_size
    chk("Protokoll über 5 MB wird auf die letzten 2 MB gekürzt, an einer Zeilengrenze", before > 5e6 and 1.9e6 < after <= 2e6 and cut == before - after and T.LOG_PATH.read_bytes()[:1] == b"x")
    with open(T.LOG_PATH, "a", encoding="utf-8") as f:
        f.write("2026-11-15 12:00:00  Testzeile für den Bericht äöü\n")
    txt = T.report_text({"Fenster": "1480×900", "Browser-Kennung": "Test/1.0"})
    want = [f"Version: {T.VERSION}", "Betriebssystem:", "Prozessor:", "ffmpeg:", f"Datenordner: {D}", "Projektdateien:", "Fenster: 1480×900", "── Protokoll", "Testzeile für den Bericht äöü"]
    chk("Fehlerbericht enthält Version, System, Speicher, Angaben der Oberfläche und das Protokoll", all(x in txt for x in want), [x for x in want if x not in txt])
    chk("der Bericht bleibt handlich (höchstens die letzten 400 KB des Protokolls)", len(txt.encode("utf-8")) < 450_000, len(txt))


if MODE == "umzug":
    umzug()
    sys.exit(1 if BAD else 0)
def bild_236():
    """2.36: Weißabgleich (segments[].wb), Bild hinter dem freigestellten Hauptbild (key.bgImg), Tempo in Stufen, Standbild als
    Bild-Einschub – am fertigen Video ausgemessen; dazu „Bild beruhigen“ (Kopie mit denselben Bildzeiten, ruhigeres Bild, Abbruch,
    Speicherverwaltung)."""
    import numpy as np
    vd = TMP / "bild"
    vd.mkdir(parents=True, exist_ok=True)
    W, H, FPS = 640, 360, 30

    def ff(*a):
        subprocess.run([T.FFMPEG, "-v", "error", "-y", *a], check=True, capture_output=True)
    video = vd / "gruen.mp4"   # Greenscreen mit einem Feld mit warmem Farbstich (160, 128, 96), 4 s
    ff("-f", "lavfi", "-i", f"color=c=0x00FF00:s={W}x{H}:r={FPS}:d=4,drawbox=x=200:y=80:w=240:h=200:color=0xA08060:t=fill", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "10", "-g", "15", str(video))
    ff("-f", "lavfi", "-i", "color=c=0x2040C0:s=320x320", "-frames:v", "1", str(vd / "blau.png"))   # quadratisch: muss füllend eingepasst werden
    KEY = {"colors": ["#00ff00"], "tol": 0.3, "soft": 0.05, "spill": True, "bg": "#c02020"}

    def seg(a, b, **kw):
        return {"kind": "main", "src": 0, "uri": str(video), "in": a, "out": b, "zooms": [], "hasAudio": False, "hasVideo": True, "speed": 1, "vol": 1,
                "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1, **kw}

    def plan(name, segs, **kw):
        return {"format": "video", "name": name, "width": W, "height": H, "fps": FPS, "total": round(sum((s["out"] - s["in"]) / (s.get("speed") or 1) for s in segs), 3), "quality": "hoch", "burn": False,
                "audioFormat": "wav", "overlays": [], "segments": segs,
                "sources": [{"uri": str(video), "name": "gruen.mp4", "duration": 4, "width": W, "height": H, "fps": FPS, "hasAudio": False, "hasVideo": True}], **kw}

    def rgb(file):   # alle Bilder in Farbe
        raw = subprocess.run([T.FFMPEG, "-v", "error", "-i", str(file), "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(int)

    def px(f, x, y):   # Mittel über 9 × 9 Pixel
        return [int(round(v)) for v in f[y - 4:y + 5, x - 4:x + 5].reshape(-1, 3).mean(axis=0)]

    def close(a, b, tol=6):
        return all(abs(a[i] - b[i]) <= tol for i in range(3))

    # ── Weißabgleich ──
    chk("Weißabgleich aus dem Plan: nur drei gültige Werte zählen, [1, 1, 1] ist keiner",
        T.wb_gains([0.8, 1, 1.3]) == [0.8, 1.0, 1.3] and T.wb_gains([1, 1, 1]) is None and T.wb_gains(None) is None and T.wb_gains(["x", 1, 1]) is None and T.wb_gains([9, 1, 0.01]) == [4.0, 1.0, 0.25])
    inp, graph = T.build_graph(plan("w1", [seg(0, 1, wb=[0.8, 1, 1.3333], contrast=0.1)]), True, None)
    chk("Filtergraph: Weißabgleich als Verstärkung je Farbkanal, vor Helligkeit und Kontrast", -1 < graph.find("colorchannelmixer=rr=0.8000:gg=1.0000:bb=1.3333") < graph.find("eq=brightness"), graph[:300])
    inp, graph = T.build_graph(plan("w2", [seg(0, 1)]), True, None)
    chk("Filtergraph: ohne Weißabgleich bleibt die Farbkette, wie sie war", "colorchannelmixer" not in graph)
    f0 = rgb(T.export_job(job(), plan("bild_ohne", [seg(0, 1)]))["playable"])
    f1 = rgb(T.export_job(job(), plan("bild_wb", [seg(0, 1, wb=[0.8, 1, 1.3333])]))["playable"])
    chk("Export: Das Feld mit Farbstich (160, 128, 96) wird mit dem Weißabgleich neutral grau", close(px(f0[15], 320, 120), [160, 128, 96]) and close(px(f1[15], 320, 120), [126, 126, 124], 4), [px(f0[15], 320, 120), px(f1[15], 320, 120)])

    # ── Bild hinter dem freigestellten Hauptbild ──
    inp, graph = T.build_graph(plan("k1", [seg(0, 1, key={**KEY, "bgImg": str(vd / "blau.png")})]), True, None)
    chk("Filtergraph: Das Hintergrundbild kommt als eigene Eingabe und füllt die Fläche", inp.count("-i") == 2 and "force_original_aspect_ratio=increase,crop=640:360" in graph and "color=c=0xc02020" not in graph, graph[:200])
    inp, graph = T.build_graph(plan("k2", [seg(0, 1, key={**KEY, "bgImg": str(vd / "fehlt.png")})]), True, None)
    chk("Filtergraph: Fehlt die Bilddatei, gilt die Hintergrundfarbe", inp.count("-i") == 1 and "color=c=0xc02020" in graph)
    fk = rgb(T.export_job(job(), plan("bild_farbe", [seg(0, 1, key=KEY)]))["playable"])
    fb = rgb(T.export_job(job(), plan("bild_hintergrund", [seg(0, 1, key={**KEY, "bgImg": str(vd / "blau.png")})]))["playable"])
    chk("Export: freigestellt über der Hintergrundfarbe wie bisher", close(px(fk[15], 40, 40), [192, 32, 32], 8) and close(px(fk[15], 320, 120), [160, 128, 96], 8), [px(fk[15], 40, 40), px(fk[15], 320, 120)])
    chk("Export: Mit Hintergrundbild steht das Bild hinter dem Feld, das Feld bleibt", close(px(fb[15], 40, 40), [32, 64, 192], 8) and close(px(fb[15], 600, 330), [32, 64, 192], 8) and close(px(fb[15], 320, 120), [160, 128, 96], 8), [px(fb[15], 40, 40), px(fb[15], 320, 120)])
    fs = rgb(T.export_job(job(), plan("bild_klein", [seg(0, 1, sc=0.5, key={**KEY, "bgImg": str(vd / "blau.png")})]))["playable"])
    chk("Export: Ist das Hauptbild verkleinert, füllt der Hintergrund auch den Rand", close(px(fs[15], 20, 20), [32, 64, 192], 8) and close(px(fs[15], 320, 165), [160, 128, 96], 8), [px(fs[15], 20, 20), px(fs[15], 320, 165)])
    fw = rgb(T.export_job(job(), plan("bild_beides", [seg(0, 1, wb=[0.8, 1, 1.3333], key={**KEY, "bgImg": str(vd / "blau.png")})]))["playable"])
    chk("Export: Weißabgleich und Hintergrundbild zusammen – das Feld neutral, der Hintergrund unverändert", close(px(fw[15], 320, 120), [126, 126, 124], 5) and close(px(fw[15], 40, 40), [32, 64, 192], 8), [px(fw[15], 320, 120), px(fw[15], 40, 40)])

    fg = rgb(T.export_job(job(), plan("bild_sw", [seg(0, 1, gray=True, contrast=0.2, key={**KEY, "bgImg": str(vd / "blau.png")})]))["playable"])
    p1, p2 = px(fg[15], 320, 120), px(fg[15], 40, 40)
    chk("Export: Schwarzweiß und Kontrast gelten für das freigestellte Bild – freigestellt wird vorher, der Hintergrund behält seine Farbe", max(p1) - min(p1) <= 4 and close(p2, [32, 64, 192], 8), [p1, p2])
    fl = rgb(T.export_job(job(), plan("bild_rand", [seg(0, 1, sc=0.5, tx=0.2, key=KEY)]))["playable"])
    chk("Export: Auch die Hintergrundfarbe füllt den Rand eines verkleinerten, verschobenen Hauptbilds", close(px(fl[15], 20, 20), [192, 32, 32], 8) and close(px(fl[15], 448, 165), [160, 128, 96], 8), [px(fl[15], 20, 20), px(fl[15], 448, 165)])
    # ── Tempo in Stufen und Standbild ──
    steps = [seg(0, 1, speed=1), seg(1, 2, speed=1.5), seg(2, 3, speed=2)]
    ft = rgb(T.export_job(job(), plan("bild_tempo", steps))["playable"])
    want = round((1 + 1 / 1.5 + 1 / 2) * FPS)
    chk("Export: drei Stufen mit 1×, 1,5× und 2× ergeben die erwartete Länge", abs(len(ft) - want) <= 2, [len(ft), want])
    ff("-i", str(video), "-vf", "select=eq(n\\,30),drawbox=x=0:y=0:w=60:h=60:color=white:t=fill", "-frames:v", "1", str(vd / "standbild.png"))
    still = {"kind": "insert", "uri": str(vd / "standbild.png"), "in": 0, "out": 1, "image": True, "hasAudio": False, "hasVideo": True, "vol": 1}
    fz = rgb(T.export_job(job(), plan("bild_standbild", [seg(0, 1), still, seg(1, 2)]))["playable"])
    chk("Export: Das Standbild steht eine Sekunde zwischen den beiden Abschnitten", len(fz) == 90 and close(px(fz[20], 30, 30), [0, 255, 0], 12) and close(px(fz[45], 30, 30), [255, 255, 255], 8) and close(px(fz[75], 30, 30), [0, 255, 0], 12)
        and int(np.abs(fz[35] - fz[55]).max()) <= 6, [len(fz), px(fz[45], 30, 30)])

    # ── Bild beruhigen ──
    wack = vd / "wackel.mp4"   # ein stehendes Wolkenmuster, dessen Ausschnitt hin- und herwandert
    ff("-f", "lavfi", "-i", "nullsrc=s=760x440:r=30,geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=6,eq=contrast=4", "-frames:v", "1", str(vd / "muster.png"))
    ff("-loop", "1", "-framerate", "30", "-i", str(vd / "muster.png"), "-f", "lavfi", "-i", "sine=frequency=262:sample_rate=44100", "-vf", "crop=640:360:60+22*sin(t*9)+12*sin(t*23):40+16*cos(t*7)+9*sin(t*19)", "-t", "3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "14", "-g", "30", "-c:a", "aac", str(wack))

    def unruhe(file):   # mittlerer Unterschied aufeinanderfolgender Bilder (Graustufen, Bildmitte)
        raw = subprocess.run([T.FFMPEG, "-v", "error", "-i", str(file), "-an", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
        g = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(int)[:, 60:300, 100:540]
        return len(g), float(np.abs(g[1:] - g[:-1]).mean())
    method = T.stab_method()
    chk("Bild beruhigen: das Verfahren steht fest (vidstab, sonst deshake)", method in ("vidstab", "deshake"), method)
    j = job()
    r = T.stabilize_job(j, str(wack), 2)
    n0, u0 = unruhe(wack)
    n1, u1 = unruhe(r["uri"])
    chk("Bild beruhigen: eine Kopie im Datenordner mit Ton, derselben Bildzahl und Länge", Path(r["uri"]).parent == D / "beruhigt" and r["hasAudio"] and n1 == n0 and abs(r["duration"] - 3) < 0.1 and r["width"] == W and r["height"] == H
        and r["orig"] == str(wack) and r["method"] == method and r["level"] == 2 and j["progress"] > 0.9, [n0, n1, r["duration"]])
    chk("Bild beruhigen: Das Bild steht deutlich ruhiger", u1 < u0 * (0.6 if method == "vidstab" else 0.95), [round(u0, 2), round(u1, 2)])
    left = sorted(x.name for x in (D / "beruhigt").iterdir())
    chk("Bild beruhigen: Messdatei und Zwischenstand sind aufgeräumt", left == [Path(r["uri"]).name], left)
    t0 = time.time()
    r2 = T.stabilize_job(job(), str(wack), 2)
    chk("Bild beruhigen: Ein zweiter Aufruf nimmt die vorhandene Kopie", r2["uri"] == r["uri"] and time.time() - t0 < 1.5)
    r3 = T.stabilize_job(job(), str(wack), 9)
    u3 = unruhe(r3["uri"])[1]
    chk("Bild beruhigen: Je Stärke eine eigene Kopie; „stark“ beruhigt mehr; unbekannte Stufen fallen auf die nächste gültige", r3["uri"] != r["uri"] and r3["level"] == 3 and (u3 < u1 or method != "vidstab") and T.stabilize_job(job(), str(wack), "x")["uri"] == r["uri"], [round(u1, 2), round(u3, 2)])
    try:
        T.stabilize_job(job(), str(vd / "blau.png"), 2)
        chk("Bild beruhigen: Ein Foto wird abgewiesen", False)
    except ValueError as e:
        chk("Bild beruhigen: Ein Foto wird abgewiesen", "nur mit Videos" in str(e))
    jc = job()
    jc["cancel"] = True
    try:
        T.stabilize_job(jc, str(wack), 1)
        chk("Bild beruhigen: Abbruch", False)
    except RuntimeError:
        left = sorted(x.name for x in (D / "beruhigt").iterdir())
        chk("Bild beruhigen: Nach einem Abbruch bleibt nichts Halbes liegen", len(left) == 2 and all(x.endswith(".mp4") and ".tmp." not in x for x in left), left)
    # Speicher verwalten: beruhigte Kopien wie freigestellte
    for x in (D / "beruhigt").iterdir():
        t = time.time() - 3600
        os.utime(x, (t, t))
    mk(T.PROJ_DIR / "st1.json", json.dumps({"id": "st1", "name": "Wackelvideo", "sources": [{"uri": r["uri"], "orig": str(wack), "stab": 2, "duration": 3}], "items": []}))
    g = {x["key"]: x for x in T.storage_info()["groups"]}
    used = sorted(len(i["used"]) for i in g["stab"]["items"])
    chk("Speicher verwalten: beruhigte Kopien mit ihrer Verwendung", g["stab"]["count"] == 2 and used == [0, 1] and g["stab"]["nfree"] == 1, [g["stab"]["count"], used])
    c = T.storage_clear("stab")
    chk("Speicher verwalten: Die unbenutzte Kopie wird gelöscht, die verwendete bleibt", c["count"] == 1 and Path(r["uri"]).exists() and not Path(r3["uri"]).exists())
    (T.PROJ_DIR / "st1.json").unlink()
    chk("Die App meldet das Beruhigen an die Oberfläche und nennt das Verfahren im Fehlerbericht", T.app_info().get("stabilize") is True and "Bild beruhigen" in T.report_text({}))


def uebergabe_237():
    """2.37: Übergabe im Heimnetz – der zeitweilige Empfang neben dem eigentlichen Server: Seite fürs Handy, Auskunft, Paket als Strom
    direkt aus den Dateien, Rückgabe vom Handy, falsche Kennung, Sperre, Platzmangel, Schließen. Das „Handy“ ist hier ein HTTP-Aufruf."""
    import io
    import urllib.error
    import urllib.request
    ud = TMP / "uebergabe"
    ud.mkdir(parents=True, exist_ok=True)
    imp = ud / "importe"
    root0, T.import_root = T.import_root, lambda: imp
    video, bild = ud / "aufnahme.mp4", ud / "logo.png"
    video.write_bytes(os.urandom(700_000))
    bild.write_bytes(os.urandom(20_000))
    T.allow(video)
    T.allow(bild)
    proj = {"id": "ueb1", "name": "Rede: Haushalt", "sources": [{"uri": "@hc:m0", "name": "aufnahme.mp4", "duration": 60}], "items": [{"clip": {"uri": "@hc:m1", "name": "logo.png"}}]}

    def spec(media=True):
        return {"name": proj["name"], "header": {"format": "honeycut-projekt", "v": 1, "name": proj["name"], "project": json.loads(json.dumps(proj)),
                                                 "files": [{"n": "m0", "kind": "media", "name": "aufnahme.mp4", "duration": 60}, {"n": "m1", "kind": "media", "name": "logo.png"}]},
                "files": [{"n": "m0", "uri": str(video), "include": media}, {"n": "m1", "uri": str(bild), "include": media}]}

    def get(url, data=None):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, method="POST" if data is not None else "GET"), timeout=20) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)
    ips = T.lan_ips()
    chk("Adressen im Heimnetz: nur private IPv4-Adressen, keine doppelt", all(re.match(r"^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|192\.0\.2\.)", ip) for ip in ips) and len(set(ips)) == len(ips), ips)
    chk("ohne offenen Empfang meldet der Stand „geschlossen“", T.handover_state() == {"active": False})
    st = T.handover_start(spec(), bind="127.0.0.1")
    tok, port = T.HAND["token"], T.HAND["port"]
    base = f"http://127.0.0.1:{port}/h/{tok}"
    chk("Empfang öffnen: eigener Port, Einmal-Kennung, das Projekt steht mit seiner Größe bereit", st["active"] and port > 1024 and len(tok) >= 12 and st["offer"]["name"] == "Rede: Haushalt"
        and st["offer"]["status"] == "ready" and st["offer"]["bytes"] > 720_000 and st["inbox"] == [] and all(u.endswith(f":{port}/h/{tok}") for u in st["urls"]), {k: st[k] for k in ("port", "offer")})
    code, page, _ = get(base + "/")
    page = page.decode("utf-8")
    chk("Seite fürs Handy: Name des Projekts, Knopf in die App mit der Adresse des Empfangs, Datei zum Herunterladen",
        code == 200 and "Rede: Haushalt" in page and "intent://uebergabe?u=http%3A%2F%2F127.0.0.1%3A" in page and "scheme=honeycut;package=de.honeybalecta.textschnitt" in page and f"/h/{tok}/paket" in page and "In HoneyCut öffnen" in page)
    code, body, _ = get(base + "/info")
    info = json.loads(body)
    chk("Auskunft: App, Version und das Angebot", code == 200 and info["app"] == "honeycut" and info["version"] == T.VERSION and info["offer"] == {"name": "Rede: Haushalt", "bytes": st["offer"]["bytes"], "project": "ueb1"} and info["free"] > 0, info)
    code, pk, hd = get(base + "/paket")
    ref = ud / "vergleich.honeycut"
    T.package_export_job(job(), spec(), str(ref))
    chk("Paket als Strom: dieselben Bytes wie „Projekt weitergeben“, Länge vorab genannt", code == 200 and pk == ref.read_bytes() and int(hd.get("Content-Length")) == len(pk) == st["offer"]["bytes"] and "attachment" in hd.get("Content-Disposition", ""), [code, len(pk)])
    s2 = T.handover_state()
    chk("nach dem Holen meldet der Stand „angekommen“", s2["offer"]["status"] == "done" and s2["offer"]["done"] == 1, s2["offer"])
    # nichts anderes ist aus dem Netz erreichbar
    codes = [get(f"http://127.0.0.1:{port}{p}")[0] for p in ("/", "/api/projects", f"/{T.TOKEN}/api/info", "/h/", "/h/falsch/info", f"/h/{tok}/info/mehr", f"/h/{tok}/../api/info")]
    chk("ohne die Kennung gibt es nichts: Startseite, Schnittstelle des eigentlichen Servers und falsche Kennungen enden mit 404", all(c == 404 for c in codes) and T.HAND["bad"] == len(codes), [codes, T.HAND["bad"]])
    chk("unbekannte Adresse unter der Kennung: 404, zählt nicht als Fehlversuch", get(base + "/projekte")[0] == 404 and T.HAND["bad"] == len(codes))
    # Rückgabe vom Handy: nur der Schnitt (ohne Dateien) und mit Dateien
    proj["name"] = "Rede: Haushalt (am Handy)"
    head, plan, total = T.package_plan(spec(False))
    buf = io.BytesIO()
    T.package_write(job(), buf, head, plan, total)
    code, body, _ = get(base + "/zurueck", buf.getvalue())
    s3 = T.handover_state()
    chk("Rückgabe ohne Dateien: angenommen, steht im Eingang bereit", code == 200 and json.loads(body)["ok"] and len(s3["inbox"]) == 1 and s3["inbox"][0]["status"] == "ready" and s3["inbox"][0]["name"] == "Rede: Haushalt (am Handy)", s3["inbox"])
    res = T.handover_take(s3["inbox"][0]["id"])
    chk("Übernehmen: Kopf mit dem Projekt wie beim Paket-Import, keine Dateien; der Eingang ist danach leer",
        res["header"]["project"]["name"] == "Rede: Haushalt (am Handy)" and res["map"] == {} and T.handover_state()["inbox"] == [] and not any(imp.iterdir()), res["map"])
    code, body, _ = get(base + "/zurueck", pk)
    s4 = T.handover_state()
    res = T.handover_take(s4["inbox"][0]["id"])
    got = Path(res["map"]["m0"])
    chk("Rückgabe mit Dateien: beim Empfang entpackt, die Dateien liegen im Import-Ordner", code == 200 and got.parent.parent == imp and got.read_bytes() == video.read_bytes() and Path(res["map"]["m1"]).read_bytes() == bild.read_bytes(), res["map"])
    code, body, _ = get(base + "/zurueck", pk)
    res = T.handover_take(T.handover_state()["inbox"][0]["id"])
    chk("dieselben Dateien noch einmal: überlesen, es entsteht keine zweite Kopie", code == 200 and Path(res["map"]["m0"]) == got and len(list(got.parent.iterdir())) == 2, sorted(x.name for x in got.parent.iterdir()))
    code, body, _ = get(base + "/zurueck", b"kein Paket, nur Text" * 20)
    s5 = T.handover_state()
    chk("etwas anderes als ein Paket: abgewiesen, der Grund steht im Eingang", code == 400 and "kein HoneyCut-Projekt" in json.loads(body)["error"] and s5["inbox"][-1]["status"] == "error", [code, s5["inbox"][-1]])
    code, body, _ = get(base + "/zurueck", pk[:len(pk) // 2])
    part = [x.name for x in got.parent.iterdir() if x.name.endswith(".part")]
    chk("abgeschnittenes Paket: abgewiesen, kein halbes Stück bleibt liegen", code == 400 and not part, [code, part])
    try:
        T.handover_take("gibtsnicht")
        chk("Übernehmen ohne Eintrag wird abgewiesen", False)
    except ValueError:
        chk("Übernehmen ohne Eintrag wird abgewiesen", True)
    du0, T.shutil.disk_usage = T.shutil.disk_usage, lambda p: type("U", (), {"free": 1000})()
    try:
        code, body, _ = get(base + "/zurueck", pk)
        free = json.loads(get(base + "/info")[1])["free"]
    finally:
        T.shutil.disk_usage = du0
    chk("zu wenig Platz auf dem Computer: abgewiesen, bevor etwas geschrieben ist; die Auskunft nennt 0 freie Bytes", code == 507 and "zu wenig Platz" in json.loads(body)["error"] and free == 0, [code, body[:80], free])
    # ein zweites Öffnen behält Kennung und Port; ohne Projekt wartet der Empfang nur
    st2 = T.handover_start(None, bind="127.0.0.1")
    chk("erneutes Öffnen: derselbe Empfang, dasselbe Angebot", T.HAND["token"] == tok and T.HAND["port"] == port and st2["offer"]["name"] == "Rede: Haushalt")
    # Sperre nach zu vielen falschen Kennungen
    max0, T.HAND_BAD_MAX = T.HAND_BAD_MAX, T.HAND["bad"] + 2
    get(f"http://127.0.0.1:{port}/h/geraten1/info")
    get(f"http://127.0.0.1:{port}/h/geraten2/info")
    for _ in range(40):
        if not T.HAND["srv"]:
            break
        time.sleep(0.1)
    T.HAND_BAD_MAX = max0
    try:
        urllib.request.urlopen(base + "/info", timeout=3)
        zu = False
    except Exception:
        zu = True
    chk("zu viele falsche Kennungen: Der Empfang schließt von selbst", T.HAND["srv"] is None and zu and T.handover_state() == {"active": False})
    # nur warten (ohne Angebot), schließen
    st3 = T.handover_start(None, bind="127.0.0.1")
    base3 = f"http://127.0.0.1:{T.HAND['port']}/h/{T.HAND['token']}"
    code, page3, _ = get(base3 + "/")
    chk("Empfang ohne Angebot: neue Kennung, die Seite spricht von der Rückgabe, kein Paket zum Holen", st3["offer"] is None and T.HAND["token"] != tok and code == 200 and "Projekt zurückgeben" in page3.decode("utf-8")
        and get(base3 + "/paket")[0] == 404 and json.loads(get(base3 + "/info")[1])["offer"] is None)
    T.handover_stop()
    chk("Schließen: nichts antwortet mehr, der Stand ist leer", T.handover_state() == {"active": False} and T.HAND["token"] == "" and T.HAND["inbox"] == {})
    chk("die App meldet die Übergabe an die Oberfläche", T.app_info().get("handover") is True)
    sf = T.uebergabe_selftest()
    chk("Selbsttest der App: Empfang öffnet, antwortet, weist ab und schließt", sf["ok"] and sf["falsch"] == 404 and sf["zu"], sf)
    T.import_root = root0


def stimmen_238():
    """2.38: Ton für das Erkennen der Personen – 16 kHz, mono, 16 Bit, ab Bildbeginn; die Datei verschwindet nach dem Abholen."""
    import numpy as np
    vd = TMP / "stimmen"
    vd.mkdir(parents=True, exist_ok=True)

    def ff(*a):
        subprocess.run([T.FFMPEG, "-v", "error", "-y", *a], check=True, capture_output=True)
    video = vd / "ton.mp4"      # 3 s Bild, Stereo-Ton mit 44,1 kHz: links 440 Hz, rechts still
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "3", "-af", "volume=0.5,pan=stereo|c0=c0|c1=0*c0",   # Scheitel 0,0625 links → gemischt rund 0,031
       "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", str(video))
    j = T.new_job("voicepcm")
    r = T.voice_pcm_job(j, str(video))
    f = T.VOICE_PCM.get(j["id"])
    chk("Ton für die Stimmen: Der Auftrag nennt die Adresse zum Abholen und die Größe", r["url"] == "api/pcm?id=" + j["id"] and f is not None and f.is_file() and r["bytes"] == f.stat().st_size, r)
    a = np.frombuffer(f.read_bytes(), dtype="<i2").astype(np.float64) / 32768
    chk("Ton für die Stimmen: 16 kHz, mono – drei Sekunden ergeben rund 48 000 Werte", abs(len(a) - 48000) < 1700, len(a))
    spec = np.abs(np.fft.rfft(a[8000:8000 + 16000] * np.hanning(16000)))
    chk("Ton für die Stimmen: Der Ton von 440 Hz kommt an (beide Kanäle gemischt)", abs(int(spec.argmax()) - 440) <= 2 and 0.02 < np.abs(a[8000:24000]).max() < 0.05, (int(spec.argmax()), round(float(np.abs(a[8000:24000]).max()), 3)))
    spaet = vd / "spaet.mp4"    # der Ton beginnt 1 s nach dem Bild: Die Stille davor gehört in die Datei, sonst lägen die Wörter falsch
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-filter_complex", "[1:a]adelay=1000:all=1,volume=0.5[a]", "-map", "0:v", "-map", "[a]", "-t", "3",
       "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", str(spaet))
    j2 = T.new_job("voicepcm")
    T.voice_pcm_job(j2, str(spaet))
    b = np.frombuffer(T.VOICE_PCM[j2["id"]].read_bytes(), dtype="<i2").astype(np.float64) / 32768
    first = int(np.argmax(np.abs(b) > 0.05))
    chk("Ton für die Stimmen: Zeiten zählen ab Bildbeginn (Ton setzt nach 1 s ein)", abs(first / 16000 - 1.0) < 0.08, round(first / 16000, 3))
    stumm = vd / "stumm.mp4"
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "1", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", str(stumm))
    j3 = T.new_job("voicepcm")
    try:
        T.voice_pcm_job(j3, str(stumm))
        err = ""
    except Exception as e:  # noqa: BLE001
        err = str(e) or "Fehler"
    left = (Path(tempfile.gettempdir()) / f"honeycut_stimmen_{j3['id']}.pcm")
    chk("Ton für die Stimmen: Ein Video ohne Ton endet mit einer Meldung, ohne Datei zu hinterlassen", bool(err) and not left.exists() and j3["id"] not in T.VOICE_PCM, err[:80])
    # Aufräumen: Dateien, deren Auftrag es nicht mehr gibt, verschwinden beim nächsten Lauf
    T.JOBS.pop(j["id"], None)
    j4 = T.new_job("voicepcm")
    T.voice_pcm_job(j4, str(video))
    chk("Ton für die Stimmen: Liegen gebliebene Dateien früherer Läufe werden beim nächsten Lauf gelöscht", not f.exists() and j["id"] not in T.VOICE_PCM and T.VOICE_PCM[j4["id"]].is_file())
    for jj in (j2, j4):
        T.VOICE_PCM.pop(jj["id"]).unlink(missing_ok=True)
    st = T.stimmen_selftest()
    chk("Ton für die Stimmen: Der Selbsttest der App besteht und räumt auf", st.get("ok") is True and not list(Path(tempfile.gettempdir()).glob("honeycut_selbsttest_*")), st)
    chk("Ton für die Stimmen: Die Oberfläche bekommt stimmen.js ausgeliefert", (T.WEB_DIR / "stimmen.js").is_file() and '"stimmen.js"' in Path(T.__file__).read_text(encoding="utf-8") and 'src="stimmen.js"' in (T.WEB_DIR / "index.html").read_text(encoding="utf-8"))


def folgen_239():
    """2.39: Masken der Person über die Zeit (person_track_job) – Zeitraster, Lage, Lücke, Abbruch – und ein Export, dessen Ausschnitt
    über viele Keyframes wandert. An Stelle des Personen-Modells erkennt eine Farbprobe die Figur (magenta)."""
    import base64
    import numpy as np
    vd = TMP / "folgen"
    vd.mkdir(parents=True, exist_ok=True)
    W, H, FPS = 640, 360, 30

    def ff(*a):
        subprocess.run([T.FFMPEG, "-v", "error", "-y", *a], check=True, capture_output=True)
    video = vd / "figur.mp4"    # 8 s: Figur steht 2 s bei 0,25, wandert in 4 s nach 0,75; zwischen 6,5 und 7,5 s ist sie weg
    x = "if(lt(t,2),0.25,if(lt(t,6),0.25+0.5*(t-2)/4,0.75))*640"
    ff("-f", "lavfi", "-i", f"color=c=0x505050:s={W}x{H}:r={FPS}", "-f", "lavfi", "-i", f"color=c=0xE020E0:s=80x240:r={FPS}", "-filter_complex",
       f"[0:v][1:v]overlay=x='{x}-40':y=60:enable='not(between(t,6.5,7.5))'[v]", "-map", "[v]", "-t", "8", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "12", "-g", "15", str(video))

    def fake(jb, mw, mh):
        def alpha(rgb):
            r, g, b = (rgb[..., k].astype(np.int16) for k in range(3))
            return ((r > 150) & (g < 110) & (b > 150)).astype(np.float32)
        return alpha
    real = T.person_alpha_fn
    T.person_alpha_fn = fake
    try:
        j = job()
        r = T.person_track_job(j, str(video))
        d = np.frombuffer(base64.b64decode(r["data"]), np.uint8).reshape(r["n"], r["h"], r["w"]).astype(float)
        chk("Person verfolgen: alle 0,25 s eine Maske mit 32 × 18 Feldern", r["step"] == 0.25 and (r["w"], r["h"]) == (32, 18) and 31 <= r["n"] <= 33 and j["progress"] > 0.9, (r["step"], r["n"]))

        def cx(k):
            c = d[k].sum(axis=0)
            return float((c * (np.arange(32) + 0.5)).sum() / c.sum() / 32) if c.sum() > 0 else -1.0
        got = [round(cx(k), 3) for k in (2, 8, 16, 24, 31)]
        chk("Person verfolgen: Die Lage der Figur stimmt zu jeder Zeit (0,25 → 0,75 der Bildbreite)", all(abs(g - w) < 0.03 for g, w in zip(got, (0.25, 0.25, 0.5, 0.75, 0.75))), got)
        chk("Person verfolgen: Solange niemand im Bild ist, bleibt die Maske leer", d[27].sum() == 0 and d[28].sum() == 0 and d[25].sum() > 0)
        rows = np.flatnonzero(d[4].sum(axis=1) > 0)
        chk("Person verfolgen: Die Maske steht aufrecht (Figur von 17 % bis 83 % der Höhe)", abs(rows[0] / 18 - 60 / 360) < 0.07 and abs((rows[-1] + 1) / 18 - 300 / 360) < 0.07, (int(rows[0]), int(rows[-1])))
        jc = job()
        jc["cancel"] = True
        try:
            T.person_track_job(jc, str(video))
            err = ""
        except Exception as e:  # noqa: BLE001
            err = str(e)
        chk("Person verfolgen: Abbruch beendet den Auftrag", err == "Abgebrochen", err)
        png = vd / "bild.png"
        ff("-f", "lavfi", "-i", "color=c=0x2040C0:s=320x180", "-frames:v", "1", str(png))
        try:
            T.person_track_job(job(), str(png))
            err = ""
        except Exception as e:  # noqa: BLE001
            err = str(e)
        chk("Person verfolgen: Ein Standbild wird mit einer Meldung abgelehnt", "nur in Videos" in err, err)
    finally:
        T.person_alpha_fn = real

    # Export: Hochformat aus dem Querformat, der Ausschnitt folgt der Figur über 41 Keyframes
    OW, OH, sc, wf = 360, 640, 3.1605, 1.0     # eingepasst füllt das Video die Breite der Leinwand (wf = 1); mit sc füllt es die Höhe

    def person(t):
        return 0.25 if t < 2 else 0.25 + 0.5 * (t - 2) / 4 if t < 6 else 0.75
    kf = [{"t": round(k * 0.15, 3), "tx": round(-(person(k * 0.15) - 0.5) * sc * wf, 4), "ty": 0, "sc": sc} for k in range(41)]
    plan = {"format": "video", "name": "folgen", "width": OW, "height": OH, "fps": FPS, "total": 6.0, "quality": "hoch", "burn": False, "audioFormat": "wav", "overlays": [],
            "segments": [{"kind": "main", "src": 0, "uri": str(video), "in": 0, "out": 6.0, "zooms": [], "hasAudio": False, "hasVideo": True, "speed": 1, "vol": 1,
                          "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": kf[0]["tx"], "ty": 0, "sc": sc, "kf": kf}],
            "sources": [{"uri": str(video), "name": "figur.mp4", "duration": 8, "width": W, "height": H, "fps": FPS, "hasAudio": False, "hasVideo": True}]}
    res = T.export_job(job(), plan)
    raw = subprocess.run([T.FFMPEG, "-v", "error", "-i", res["playable"], "-an", "-vf", "scale=90:160", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, 160, 90, 3).astype(int)
    pos = []
    for n in (15, 45, 90, 120, 150, 175):
        m = (fr[n][..., 0] > 150) & (fr[n][..., 1] < 110) & (fr[n][..., 2] > 150)
        pos.append(round(float((m.sum(axis=0) * (np.arange(90) + 0.5)).sum() / max(1, m.sum()) / 90), 3))
    chk("Export mit 41 Keyframes: Die Figur bleibt über den ganzen Gang in der Bildmitte", len(fr) >= 178 and all(abs(p - 0.5) < 0.03 for p in pos), pos)
    chk("Export mit 41 Keyframes: Hochformat in voller Höhe (Figur von 17 % bis 83 %)", (lambda m: abs(np.flatnonzero(m.sum(axis=1))[0] / 160 - 60 / 360) < 0.03 and abs((np.flatnonzero(m.sum(axis=1))[-1] + 1) / 160 - 300 / 360) < 0.03)((fr[45][..., 0] > 150) & (fr[45][..., 1] < 110) & (fr[45][..., 2] > 150)))
    for f in res.get("files") or [res["playable"]]:
        Path(f).unlink(missing_ok=True)
    T.person_alpha_fn = fake
    try:
        st = T.folgen_selftest()
    finally:
        T.person_alpha_fn = real
    chk("Der Selbsttest der App besteht (hier mit der Farbprobe an Stelle des Modells) und räumt auf", st.get("ok") is True and not list(Path(tempfile.gettempdir()).glob("honeycut_selbsttest_*")), st)
    chk("Die Oberfläche bekommt folgen.js ausgeliefert", (T.WEB_DIR / "folgen.js").is_file() and '"folgen.js"' in Path(T.__file__).read_text(encoding="utf-8") and 'src="folgen.js"' in (T.WEB_DIR / "index.html").read_text(encoding="utf-8"))


def skript_240():
    """2.40: Der Rechenkern für „Skript abgleichen“ wird mit der Oberfläche ausgeliefert."""
    src = Path(T.__file__).read_text(encoding="utf-8")
    html = (T.WEB_DIR / "index.html").read_text(encoding="utf-8")
    chk("Die Oberfläche bekommt skript.js ausgeliefert", (T.WEB_DIR / "skript.js").is_file() and '"skript.js"' in src and 'src="skript.js"' in html)
    order = [html.index(f'src="{f}"') for f in ("chroma.js", "stimmen.js", "folgen.js", "skript.js", "bridge-http.js", "app.js")]
    chk("Die Rechenkerne stehen in der Seite vor der Oberfläche, die sie benutzt", order == sorted(order), order)
    build = (Path(T.__file__).parent / "web" / "build.py").read_text(encoding="utf-8")
    chk("Die Browser-Fassung nimmt die Rechenkerne in den Bau und in den Zwischenspeicher für den Betrieb ohne Netz", all(build.count(f'"{f}"') == 2 for f in ("stimmen.js", "folgen.js", "skript.js")))


def ton_241():
    """2.41: Zweite Tonquelle angleichen – Versatz und Auseinanderlaufen messen (sync_measure) und die Kopie mit dem Ton des
    Mikrofons erzeugen (audio_sync_job). Die „Szene“ ist sprachähnlicher Ton; die Kamera hört sie mit Hall, Rauschen und leiser."""
    import wave
    import numpy as np
    vd = TMP / "mikrofon"
    vd.mkdir(parents=True, exist_ok=True)
    SR = 16000
    rng = np.random.default_rng(41)

    def ff(*a):
        subprocess.run([T.FFMPEG, "-v", "error", "-y", *a], check=True, capture_output=True)

    def szene(sec):   # Silben: kurze Klänge mit wechselnder Tonhöhe, dazwischen Pausen
        x = np.zeros(int(sec * SR), np.float32)
        t = 0.3
        while t < sec - 1:
            d = rng.uniform(0.08, 0.28)
            n = int(d * SR)
            f0 = rng.uniform(100, 240)
            k = np.arange(n) / SR
            s = sum(a * np.sin(2 * np.pi * f0 * h * k + rng.uniform(0, 6)) for h, a in ((1, .5), (2, .3), (3, .2), (5, .12), (7, .08))) + rng.normal(0, 0.05, n)
            x[int(t * SR): int(t * SR) + n] += (s * np.hanning(n) * rng.uniform(0.3, 0.8)).astype(np.float32)
            t += d + (rng.uniform(0.4, 1.2) if rng.random() < 0.15 else rng.uniform(0.02, 0.1))
        return x

    def kamera(x):    # Hall, Rauschen, leiser
        ir = np.zeros(4000)
        ir[0] = 1
        for q in range(40):
            ir[rng.integers(160, 4000)] += rng.uniform(-0.25, 0.25) * np.exp(-q / 15)
        return (np.convolve(x, ir)[: len(x)] * 0.3 + rng.normal(0, 0.008, len(x))).astype(np.float32)

    def schreibe(p, x):
        with wave.open(str(p), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())

    def lese(p):      # Ton einer Datei mit SR, mono, ab Zeit 0
        raw = subprocess.run([T.FFMPEG, "-v", "error", "-i", str(p), "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768

    def lage(a, b, span=0.2):   # um wie viele Sekunden liegt b gegenüber a später (größte Übereinstimmung der Wellenform)
        n = min(len(a), len(b))
        nf = 1 << int(np.ceil(np.log2(2 * n)))
        c = np.fft.irfft(np.fft.rfft(b[:n], nf) * np.conj(np.fft.rfft(a[:n], nf)), nf)
        m = int(span * SR)
        g = np.concatenate([c[-m:], c[: m + 1]])
        return (int(np.argmax(g)) - m) / SR
    S = szene(200)
    # Fall 1: Die Kamera läuft von Szenenzeit 20 bis 80 s, das Mikrofon lief schon ab 12,6 s (7,4 s früher) bis 95 s
    schreibe(vd / "kam1.wav", kamera(S[20 * SR: 80 * SR]))
    schreibe(vd / "mik1.wav", S[int(12.6 * SR): 95 * SR])
    video = vd / "kam1.mp4"
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-i", str(vd / "kam1.wav"), "-t", "60", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-g", "25", "-c:a", "aac", "-b:a", "128k", str(video))
    m = T.sync_measure(T._sync_read(str(video), None, 0, 1), T._sync_read(str(vd / "mik1.wav"), None, 0, 1))
    chk("Versatz messen: Das Mikrofon lief 7,4 s vor der Kamera an – auf eine Millisekunde genau, eindeutig", abs(m["offset"] + 7.4) < 0.0015 and m["drift"] == 0 and T.sync_ok(m) and m["windows"] >= 8, m)
    j = job()
    r = T.audio_sync_job(j, str(video), str(vd / "mik1.wav"))
    out = Path(r["uri"]) if "uri" in r else None
    chk("Angleichen: Es entsteht eine Kopie mit Namen, Herkunft und Messwerten", out is not None and out.is_file() and out.parent == T.DATA_DIR / "mikrofon" and r["name"] == "kam1 – Mikrofon" and r["orig"] == str(video) and r["mic"] == "mik1.wav"
        and abs(r["offset"] + 7.4) < 0.0015 and r["video"] == "copy" and j["progress"] > 0.9, {k: r.get(k) for k in ("name", "mic", "offset", "video")})
    chk("Angleichen: Länge, Bildgröße und Bildrate bleiben", abs(r["duration"] - 60) < 0.1 and (r["width"], r["height"]) == (320, 180) and abs(r["fps"] - 25) < 0.01 and r["hasAudio"], (r["duration"], r["fps"]))

    def pakete(p):
        o = subprocess.run([T.FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,size", "-of", "csv=p=0", str(p)], capture_output=True, text=True, check=True).stdout
        return [ln for ln in o.splitlines() if ln.strip()]
    chk("Angleichen: Das Bild ist unverändert übernommen (dieselben Bildpakete zu denselben Zeiten)", pakete(video) == pakete(out) and len(pakete(out)) == 1500, len(pakete(out)))
    neu = lese(out)
    soll = S[20 * SR: 80 * SR]
    chk("Angleichen: Der Ton des Mikrofons liegt genau unter dem Bild (Abweichung unter 2 ms) – ohne Hall und Rauschen der Kamera",
        abs(lage(soll, neu)) <= 0.002 and float(np.corrcoef(soll[SR: 50 * SR], neu[SR + int(round(lage(soll, neu) * SR)): 50 * SR + int(round(lage(soll, neu) * SR))])[0, 1]) > 0.9, lage(soll, neu))
    t0 = time.time()
    r2 = T.audio_sync_job(job(), str(video), str(vd / "mik1.wav"))
    chk("Ein zweiter Aufruf mit denselben Dateien liefert die vorhandene Kopie", r2["uri"] == r["uri"] and r2["offset"] == r["offset"] and time.time() - t0 < 2)
    # Fall 2: Das Mikrofon startet 5,25 s nach der Kamera und endet vor ihr: Davor und danach ist Stille
    schreibe(vd / "mik2.wav", S[int(25.25 * SR): 60 * SR])
    r = T.audio_sync_job(job(), str(video), str(vd / "mik2.wav"))
    neu = lese(r["uri"])
    chk("Später gestartetes Mikrofon: richtig gelegt, davor und dahinter Stille, Länge wie das Video", abs(r["offset"] - 5.25) < 0.0015 and abs(lage(soll, neu)) <= 0.002
        and float(np.abs(neu[: 5 * SR]).max()) < 0.01 and float(np.abs(neu[41 * SR: 59 * SR]).max()) < 0.01 and float(np.abs(neu[6 * SR: 39 * SR]).max()) > 0.1 and abs(r["duration"] - 60) < 0.1, (r["offset"], lage(soll, neu)))
    # Fall 3: lange Aufnahme, die Uhr des Mikrofons läuft 200 Millionstel schneller: Am Ende lägen sonst 35 ms dazwischen
    schreibe(vd / "kam3.wav", kamera(S[10 * SR: 190 * SR]))
    mic3 = S[int(6 * SR): int(198 * SR)]
    d = 200e-6
    n3 = int(len(mic3) * (1 - d))
    schreibe(vd / "mik3.wav", np.interp(np.arange(n3) / (1 - d), np.arange(len(mic3)), mic3).astype(np.float32))
    video3 = vd / "kam3.mp4"
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-i", str(vd / "kam3.wav"), "-t", "180", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-g", "50", "-c:a", "aac", "-b:a", "128k", str(video3))
    r = T.audio_sync_job(job(), str(video3), str(vd / "mik3.wav"))
    neu, soll3 = lese(r["uri"]), S[10 * SR: 190 * SR]
    anf, end = lage(soll3[5 * SR: 25 * SR], neu[5 * SR: 25 * SR]), lage(soll3[155 * SR: 175 * SR], neu[155 * SR: 175 * SR])
    chk("Auseinanderlaufende Uhren: erkannt (200 Millionstel) und ausgeglichen – Anfang und Ende liegen beide auf 3 ms genau", abs(r["drift"] - d) < 3e-5 and abs(r["offset"] + 4.0) < 0.003 and abs(anf) <= 0.003 and abs(end) <= 0.003, (r["drift"], r["offset"], anf, end))
    # Fehlerfälle
    schreibe(vd / "fremd.wav", szene(40))

    def fehler(*a):
        try:
            T.audio_sync_job(job(), *a)
            return ""
        except Exception as e:  # noqa: BLE001
            return str(e)
    before_n = len(list((T.DATA_DIR / "mikrofon").glob("*")))
    chk("Eine fremde Aufnahme wird mit einer Meldung abgelehnt, es entsteht keine Datei", "passen nicht erkennbar zusammen" in fehler(str(video), str(vd / "fremd.wav")) and len(list((T.DATA_DIR / "mikrofon").glob("*"))) == before_n)
    stumm = vd / "stumm.mp4"
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-t", "3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(stumm))
    chk("Ein Video ohne eigenen Ton und eine Datei ohne Ton werden mit einer Meldung abgelehnt", "keinen eigenen Ton" in fehler(str(stumm), str(vd / "mik1.wav")) and "keinen Ton" in fehler(str(video), str(stumm)))
    jc = job()
    jc["cancel"] = True
    try:
        T.audio_sync_job(jc, str(video), str(vd / "fremd.wav"))
        err = ""
    except Exception as e:  # noqa: BLE001
        err = str(e)
    chk("Abbruch beendet den Auftrag ohne Reste", "Abgebrochen" in err and not list((T.DATA_DIR / "mikrofon").glob("*.tmp.mp4")) and not list(Path(tempfile.gettempdir()).glob("honeycut_sync_*")), err)
    sel = T.tonquelle_selftest()
    chk("Der Selbsttest der App besteht und räumt auf", sel.get("ok") is True and not list(Path(tempfile.gettempdir()).glob("honeycut_selbsttest_*")) and len(list((T.DATA_DIR / "mikrofon").glob("*.mp4"))) == 3, sel)
    # Speicher verwalten
    st = T.storage_info() if hasattr(T, "storage_info") else None
    grp = next((g for g in (st or {}).get("groups", []) if g.get("key") == "mic"), None)
    chk("Speicher verwalten kennt die Kopien mit Mikrofon-Ton", grp is not None and grp["count"] == 3 and grp["bytes"] > 0, grp and (grp["count"], grp["bytes"]))


def exportordner_2521():
    """2.52.1: Export aus einem früheren Export (Ordner „…_honeycut“) landet in diesem Ordner statt in einem weiteren darin;
    alle Pfade bleiben unter der Grenze von Windows (259 Zeichen). Nachgestellt mit den Namen aus Raphaels Fehlerbericht."""
    base = TMP / "Quick Share Nachbau"
    first = "Video_262256_DJI_20261122180004_0007_D_MP4_159260686_59000_202611221814_video_original"
    prev = "Video_262496_DJI_20261122181428_0022_D_MP4_210591843_78000_20261122181546_video_original + 16_geschnitten"
    # Pfadlängen wie auf Raphaels Rechner („C:\\Users\\strat\\Downloads\\Quick Share“ hat 36 Zeichen)
    win = Path("C:/Users/strat/Downloads/Quick Share".replace("/", os.sep)) if os.name == "nt" else Path("/" + "u" * 35)
    d1, s1 = T.export_target(win / f"{first}.MP4", prev)
    chk("Export der 17 Aufnahmen: Ordner und Name wie bisher, solange alles unter der Grenze bleibt",
        d1.name == f"{first}_honeycut" and s1 == prev and len(str(d1 / f"Untertitel – {s1}.srt")) <= 259, [d1.name, s1])
    d2, s2 = T.export_target(d1 / f"{prev}.mp4", "URENCO_geschnitten")
    chk("Export aus diesem Export: landet im selben Ordner „…_honeycut“, kein Ordner im Ordner", d2 == d1 and s2 == "URENCO_geschnitten", [str(d2), s2])
    longest = max(len(str(d2 / f"Untertitel – {s2}.srt")), len(str(d2 / f"{s2} – Textfassung.txt")))
    chk("… und der längste Pfad (SRT, Textfassung) bleibt unter der Grenze von Windows", longest <= 259, longest)
    deep = win / "Projekte Honey Balecta" / "November 2026 – Videos"
    d3, s3 = T.export_target(deep / f"{first}.MP4", prev + " und noch viel mehr Text im Namen des Projekts")
    l3 = max(len(str(d3 / f"Untertitel – {s3}.srt")), len(str(d3 / f"{s3} – Textfassung.txt")))
    chk("Lange Namen in tiefem Ordner: erst der Ordnername, dann der Name des Exports gekürzt, alles unter der Grenze",
        l3 <= 259 and len(str(d3)) <= 247 and d3.name.endswith("_honeycut") and d3.name.startswith("Video_262256") and s3.startswith("Video_262496") and not s3.endswith((" ", ".")), [l3, d3.name, s3])
    d4, s4 = T.export_target(base / "kurz.mp4", "Kurz_geschnitten")
    chk("Kurze Namen bleiben unverändert", d4 == base / "kurz_honeycut" and s4 == "Kurz_geschnitten", [str(d4), s4])
    # echter Export (ffmpeg nachgestellt): aus einem früheren Export, mit Untertiteln und Titelbild, gleicher Name wie die Quelle
    old = base / f"{first}_honeycut"
    old.mkdir(parents=True, exist_ok=True)
    src = old / f"{prev}.mp4"
    src.write_bytes(b"frueherer Export")
    render0 = T.render_plan
    T.render_plan = lambda job, plan, out, with_video, cues: (Path(out).write_bytes(b"neu"), None)[1]
    cues = [{"start": 0.5, "end": 2.0, "text": "Hallo"}]
    plan = {"format": "video", "name": "URENCO_geschnitten", "segments": [{"uri": str(src), "in": 0, "out": 3}], "sources": [{"uri": str(src)}],
            "subs": {"cues": cues, "style": {}}, "textfile": {"text": "Text"}, "extras": [{"name": "U" * 120 + " – Titelbild.jpg", "data": "aGFsbG8="}]}
    try:
        r = T.export_job(job(), plan)
        same = base / "k_honeycut" / "Quelle.mp4"
        same.parent.mkdir(parents=True, exist_ok=True)
        same.write_bytes(b"Aufnahme")
        r2 = T.export_job(job(), {**plan, "name": "Quelle", "segments": [{"uri": str(same), "in": 0, "out": 3}], "sources": [{"uri": str(same)}], "extras": []})
    finally:
        T.render_plan = render0
    names = sorted(Path(f).name for f in r["files"])
    chk("Export aus dem früheren Export: Video, SRT, Textfassung und Titelbild liegen im vorhandenen Ordner",
        Path(r["folder"]) == old and all(Path(f).parent == old and Path(f).is_file() for f in r["files"]) and len(names) == 4
        and "URENCO_geschnitten.mp4" in names and "Untertitel – URENCO_geschnitten.srt" in names, names)
    chk("Heißt der neue Export wie die Aufnahme, überschreibt er sie nicht („(neu)“)",
        same.read_bytes() == b"Aufnahme" and Path(r2["playable"]).name == "Quelle (neu).mp4", Path(r2["playable"]).name)


PARTS = (speichern_und_fassungen, speicher, sicherung, projektpakete, kleine_helfer, quellen_und_belege, schrift_im_export, transkript, export_231, untertitel_effekte, ton_234, belege_235, bild_236, uebergabe_237, stimmen_238, folgen_239, skript_240, ton_241, exportordner_2521, neue_versionen, bericht_und_protokoll)
for part in [p for p in PARTS if p.__name__ == MODE] or PARTS:
    print(f"── {part.__name__.replace('_', ' ')} ──", flush=True)
    part()
print(f"ERGEBNIS Backend ohne Browser: {N} geprüft, {BAD} Fehler")
sys.exit(1 if BAD else 0)
